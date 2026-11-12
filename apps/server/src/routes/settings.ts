import {
  keptTimes,
  ruleOptions,
  rules,
  updateRuleBody,
  updateSettingsBody,
  type RuleSettingDto,
  type SettingsResponse,
  type UpdateRuleResponse,
  type UpdateSettingsResponse,
  type UserSettingsDto,
} from "@pr-peek/core";
import express, { type Request, type Router } from "express";
import type { Db } from "../db";
import type { UserSettings } from "../generated/prisma/client";
import { HttpError, parseInput, sentFields } from "../http-error";
import { loadRuleSettings, type EffectiveRuleSetting } from "../items";
import { currentUser, requireUser } from "./auth";

export interface SettingsDeps {
  db: Db;
  // Queues a sync for the user. False if one was already queued or running.
  requestSync: (userId: string) => Promise<boolean>;
  now?: () => Date;
}

function toSettingsDto(row: UserSettings): UserSettingsDto {
  return {
    timezone: row.timezone,
    staleWarnHours: row.staleWarnHours,
    staleLateHours: row.staleLateHours,
    workHoursOnly: row.workHoursOnly,
    remindEveryHours: row.remindEveryHours,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    quietWeekends: row.quietWeekends,
    highBreaksQuiet: row.highBreaksQuiet,
    digestTime: row.digestTime,
    keptQuietStart: row.keptQuietStart,
    keptQuietEnd: row.keptQuietEnd,
    keptDigestTime: row.keptDigestTime,
    hideBots: row.hideBots,
    includeTeamRequests: row.includeTeamRequests,
    showAuthors: row.showAuthors,
    onboarded: row.onboardedAt !== null,
  };
}

function toRuleDto(setting: EffectiveRuleSetting): RuleSettingDto {
  const { rule } = setting;
  return {
    id: rule.id,
    name: rule.name,
    group: rule.group,
    defaultSeverity: rule.defaultSeverity,
    defaultChannels: rule.defaultChannels,
    enabled: setting.enabled,
    severity: setting.severity,
    channels: setting.channels,
    options: setting.options,
  };
}

export function settingsRouter(deps: SettingsDeps): Router {
  const router = express.Router();
  const { db } = deps;
  const now = () => (deps.now ?? (() => new Date()))();
  router.use(["/settings", "/rules"], requireUser(db));

  // Brings the user's items in line with a setting that changes what rules find: the next
  // sync runs them on every PR again (see sync.ts). Queued now, so the list updates in
  // seconds. If queueing fails, the next scheduled sync still does it. Returns when, for
  // `listUpdatingSince`.
  async function refreshItems(req: Request, userId: string): Promise<string> {
    const at = now();
    await db.user.updateMany({
      where: { id: userId },
      data: { rulesStaleAt: at },
    });
    await deps.requestSync(userId).catch((err: unknown) => {
      req.log.warn({ err }, "queueing a sync after a setting failed");
    });
    return at.toISOString();
  }

  router.get("/settings", async (_req, res) => {
    const userId = currentUser(res).id;
    const [settings, ruleSettings] = await Promise.all([
      db.userSettings.findUniqueOrThrow({ where: { userId } }),
      loadRuleSettings(db, userId),
    ]);
    const body: SettingsResponse = {
      settings: toSettingsDto(settings),
      rules: ruleSettings.map(toRuleDto),
    };
    res.json(body);
  });

  router.patch("/settings", async (req, res) => {
    const userId = currentUser(res).id;
    const changes = parseInput(updateSettingsBody, req.body);
    const current = await db.userSettings.findUniqueOrThrow({
      where: { userId },
    });

    // Either limit can arrive alone, so check them together.
    const warn = changes.staleWarnHours ?? current.staleWarnHours;
    const late = changes.staleLateHours ?? current.staleLateHours;
    if (warn >= late) {
      throw new HttpError(
        400,
        "invalid_input",
        "staleWarnHours must be less than staleLateHours",
      );
    }

    // The timezone is onboarding's last step, so saving one finishes it. Older apps
    // finish it this way too, since they send nothing else.
    const finishes = changes.timezone !== undefined && !current.onboardedAt;
    const updated = await db.userSettings.update({
      where: { userId },
      data: {
        ...sentFields(changes),
        ...keptTimes(changes),
        ...(finishes && { onboardedAt: now() }),
      },
    });
    const affectsRules =
      updated.hideBots !== current.hideBots ||
      updated.includeTeamRequests !== current.includeTeamRequests;
    const body: UpdateSettingsResponse = {
      settings: toSettingsDto(updated),
      listUpdatingSince: affectsRules ? await refreshItems(req, userId) : null,
    };
    res.json(body);
  });

  router.patch("/rules/:ruleId", async (req, res) => {
    const userId = currentUser(res).id;
    const rule = rules.find((r) => r.id === req.params.ruleId);
    if (!rule) throw new HttpError(404, "not_found", "Rule not found");
    const changes = parseInput(updateRuleBody, req.body);

    const where = { userId_ruleId: { userId, ruleId: rule.id } };
    const existing = await db.ruleSetting.findUnique({ where });
    const options = {
      ...ruleOptions.catch({}).parse(existing?.options ?? {}),
      ...changes.options,
    };
    const sent = { ...sentFields(changes), options };
    // Users from before rule settings existed have no row yet.
    await db.ruleSetting.upsert({
      where,
      create: {
        userId,
        ruleId: rule.id,
        severity: rule.defaultSeverity,
        channels: rule.defaultChannels,
        ...sent,
      },
      update: sent,
    });

    const affectsRules = changes.enabled !== undefined || changes.options;
    const listUpdatingSince = affectsRules
      ? await refreshItems(req, userId)
      : null;
    // Every rule is in the list, so this always finds it.
    const saved = (await loadRuleSettings(db, userId)).find(
      (s) => s.rule.id === rule.id,
    )!;
    const body: UpdateRuleResponse = {
      rule: toRuleDto(saved),
      listUpdatingSince,
    };
    res.json(body);
  });

  return router;
}

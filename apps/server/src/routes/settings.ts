import {
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
import type { Octokit } from "octokit";
import type { Db } from "../db";
import type { UserSettings } from "../generated/prisma/client";
import { HttpError, parseInput, sentFields } from "../http-error";
import {
  loadRuleSettings,
  rerunRules,
  type EffectiveRuleSetting,
} from "../items";
import { currentUser, requireUser } from "./auth";

export interface SettingsDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: (userId: string) => Promise<Octokit>;
}

function toSettingsDto(row: UserSettings): UserSettingsDto {
  return {
    timezone: row.timezone,
    staleWarnHours: row.staleWarnHours,
    staleLateHours: row.staleLateHours,
    workHoursOnly: row.workHoursOnly,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    quietWeekends: row.quietWeekends,
    digestTime: row.digestTime,
    hideBots: row.hideBots,
    includeTeamRequests: row.includeTeamRequests,
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
  router.use(["/settings", "/rules"], requireUser(db));

  // Brings the user's items in line with a setting that changes what rules find. If it
  // fails, the setting is still saved and each PR catches up on its next change.
  async function rerun(req: Request, userId: string) {
    await rerunRules(db, userId, () => deps.github(userId)).catch(
      (err: unknown) => req.log.warn({ err }, "re-running rules failed"),
    );
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

    const updated = await db.userSettings.update({
      where: { userId },
      data: sentFields(changes),
    });
    const affectsRules =
      updated.hideBots !== current.hideBots ||
      updated.includeTeamRequests !== current.includeTeamRequests;
    if (affectsRules) await rerun(req, userId);
    const body: UpdateSettingsResponse = { settings: toSettingsDto(updated) };
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

    if (changes.enabled !== undefined || changes.options) {
      await rerun(req, userId);
    }
    // Every rule is in the list, so this always finds it.
    const saved = (await loadRuleSettings(db, userId)).find(
      (s) => s.rule.id === rule.id,
    )!;
    const body: UpdateRuleResponse = { rule: toRuleDto(saved) };
    res.json(body);
  });

  return router;
}

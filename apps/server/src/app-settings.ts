import type { Db } from "./db";

// The one row of AppSettings.
const ID = "app";

// Whether new users wait for an admin to approve them. Off until an admin turns it on.
export async function approvesSignUps(db: Db): Promise<boolean> {
  const row = await db.appSettings.findUnique({
    where: { id: ID },
    select: { approveSignUps: true },
  });
  return row?.approveSignUps ?? false;
}

export async function setApprovesSignUps(db: Db, on: boolean): Promise<void> {
  await db.appSettings.upsert({
    where: { id: ID },
    create: { id: ID, approveSignUps: on },
    update: { approveSignUps: on },
  });
}

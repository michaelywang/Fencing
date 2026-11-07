import { CoachProvider } from "@/components/coach/CoachContext";
import { CoachNav } from "@/components/coach/CoachNav";
import { requireCoachPage } from "@/server/http";
import { getSettings, listLocations } from "@/server/services/settings";
import { listUsers } from "@/server/services/accounts";
import { todayInTimeZone } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Coach planner", template: "%s · Coach planner" } };

/** Every /coach page requires a valid session (checked on the server, per request). */
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const session = await requireCoachPage();
  const [settings, locations, users] = await Promise.all([getSettings(), listLocations({ includeArchived: true }), listUsers()]);
  return (
    <CoachProvider
      value={{
        user: session.user,
        settings: {
          timezone: settings.timezone,
          defaultPracticeMinutes: settings.defaultPracticeMinutes,
          defaultPracticeStart: settings.defaultPracticeStart,
          defaultPracticeLocationId: settings.defaultPracticeLocationId,
          defaultMeetLocationId: settings.defaultMeetLocationId,
          teamName: settings.teamName,
        },
        locations: locations.map((l) => ({ id: l.id, name: l.name, shortName: l.shortName, address: l.address, kind: l.kind, archivedAt: l.archivedAt })),
        coachNames: users.filter((u) => !u.disabledAt).map((u) => u.name),
        today: todayInTimeZone(settings.timezone),
      }}
    >
      <div className="min-h-dvh">
        <CoachNav />
        <main id="main" className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-4">
          {children}
        </main>
      </div>
    </CoachProvider>
  );
}

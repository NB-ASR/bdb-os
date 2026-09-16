import { test, expect, type Page } from "@playwright/test";

const email = process.env.BDB_E2E_OWNER_EMAIL;
const password = process.env.BDB_E2E_OWNER_PASSWORD;
const workspaceName = process.env.BDB_E2E_WORKSPACE_NAME;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email ?? "");
  await page.getByLabel("Password").fill(password ?? "");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/workspace/);
}

async function workspaceContext(page: Page) {
  const response = await page.request.get("/api/workspace/context");
  expect(response.ok()).toBeTruthy();
  const context = await response.json();
  expect(context.currentWorkspaceId).toBeTruthy();
  expect(context.currentUser?.id).toBeTruthy();
  return {
    workspaceId: String(context.currentWorkspaceId),
    actorUserId: String(context.currentUser.id),
  };
}

async function postCommand(page: Page, path: string, data: Record<string, unknown>) {
  const response = await page.request.post(path, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data,
  });
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result as Record<string, unknown>;
}

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function workspaceLocalDate(timeZone: string, daysAhead: number) {
  const target = new Date(Date.now() + daysAhead * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(target);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const iso = `${value("year")}-${value("month")}-${value("day")}`;
  const weekday = new Date(iso + "T12:00:00Z").getUTCDay();
  return { iso, weekday, weekdayLabel: weekdayNames[weekday] };
}

async function discardRejectedCalendarCommand(page: Page) {
  const formDialog = page.getByRole("dialog", { name: "New appointment", exact: true });
  await formDialog.getByRole("button", { name: "Close", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry sync", exact: true });
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("button", { name: "Discard rejected change", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discard rejected change", exact: true }).click();
  await expect(page.getByRole("button", { name: "Discard rejected change", exact: true })).toHaveCount(0);
}

async function refreshAndWait(page: Page, endpoint: RegExp) {
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toBeEnabled();
  const loaded = page.waitForResponse((response) =>
    response.request().method() === "GET"
    && endpoint.test(response.url())
    && response.ok(),
  );
  await refresh.click();
  await loaded;
  await expect(refresh).toBeEnabled({ timeout: 15_000 });
}

async function openAppointmentForm(
  page: Page,
  values: {
    customerId: string;
    serviceId: string;
    staffUserId: string;
    date: string;
    time: string;
    roomName: string;
    notes: string;
    initialStatus?: "pending" | "confirmed";
    channel?: "staff" | "phone" | "walk_in" | "online";
  },
) {
  await page.getByRole("button", { name: "New appointment" }).click();
  const appointmentDialog = page.getByRole("dialog", { name: "New appointment", exact: true });
  await appointmentDialog.getByRole("combobox", { name: "Customer", exact: true }).selectOption(values.customerId);
  if (values.channel) {
    await appointmentDialog.getByRole("combobox", { name: "Booking source", exact: true }).selectOption(values.channel);
  }
  await appointmentDialog.getByRole("combobox", { name: "Service", exact: true }).selectOption(values.serviceId);
  await expect(appointmentDialog.getByRole("combobox", { name: "Staff member", exact: true })).toHaveValue(values.staffUserId);
  await appointmentDialog.getByLabel("Date", { exact: true }).fill(values.date);
  await appointmentDialog.getByLabel("Start time", { exact: true }).fill(values.time);
  await appointmentDialog.getByRole("combobox", { name: "Room", exact: true }).selectOption(values.roomName);
  await appointmentDialog.getByLabel("Appointment notes", { exact: true }).fill(values.notes);
  if (values.initialStatus) {
    await appointmentDialog.getByRole("combobox", { name: "Initial status", exact: true }).selectOption(values.initialStatus);
  }
}

test.describe("Calendar V1 empty-state navigation", () => {
  test.describe.configure({ retries: 0 });
  test.skip(!email || !password, "Dedicated E2E owner credentials are not configured.");

  test("empty Service eligibility routes to the Service catalogue", async ({ page }) => {
    await signIn(page);
    if (workspaceName) {
      await expect(page.getByRole("heading", { name: new RegExp(workspaceName, "i") })).toBeVisible();
    }
    await page.goto("/calendar/eligibility");
    await expect(page.getByRole("heading", { name: "Service eligibility", exact: true })).toBeVisible();
    await expect(page.getByText("No active Services", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open Services", exact: true }).click();
    await expect(page).toHaveURL(/\/services$/);
  });
});

test.describe("Calendar V1 operational acceptance", () => {
  test.skip(!email || !password, "Dedicated E2E owner credentials are not configured.");

  test("authenticated owner can operate the complete Calendar V1 launch workflow", async ({ page, context }, testInfo) => {
    test.setTimeout(300_000);
    await signIn(page);
    if (workspaceName) {
      await expect(page.getByRole("heading", { name: new RegExp(workspaceName, "i") })).toBeVisible();
    }

    const { workspaceId, actorUserId } = await workspaceContext(page);
    const unique = Date.now();
    const runToken = `${Date.now()}-${testInfo.retry}-${crypto.randomUUID().slice(0, 8)}`;
    const temporaryBreak = `Acceptance temporary break ${runToken}`;
    const cancelledBreakEdit = `Acceptance cancelled break edit ${runToken}`;
    const editedBreak = `Acceptance edited break ${runToken}`;
    const lunchBreak = `Acceptance lunch ${runToken}`;
    const leaveReason = `Acceptance leave ${runToken}`;
    const cancelledLeaveReason = `Acceptance cancelled leave edit ${runToken}`;
    const updatedLeaveReason = `Acceptance leave updated ${runToken}`;
    const customerId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    const customerName = "Calendar Acceptance Customer " + unique;
    const serviceName = "Calendar Acceptance Service " + unique;
    const serviceCode = "CAL-" + String(unique).slice(-8);
    const roomCode = "ROOM-" + String(unique).slice(-6);
    const roomName = "Calendar Acceptance Room " + unique;

    await postCommand(page, "/api/customers", {
      workspaceId,
      action: "create",
      id: customerId,
      name: customerName,
      email: "calendar-" + unique + "@example.invalid",
    });
    await postCommand(page, "/api/services", {
      workspaceId,
      action: "create",
      id: serviceId,
      code: serviceCode,
      name: serviceName,
      category: "Operational acceptance",
      durationMinutes: 45,
      preparationBufferMinutes: 5,
      recoveryBufferMinutes: 5,
      price: 40,
      vatRate: 18,
      bookingMode: "customer",
    });

    const availabilityResponse = await page.request.get("/api/calendar/availability?workspaceId=" + encodeURIComponent(workspaceId));
    expect(availabilityResponse.ok()).toBeTruthy();
    const availabilityPayload = await availabilityResponse.json();
    expect(availabilityPayload.ok).toBe(true);
    const staff = (availabilityPayload.result?.staff ?? []) as Array<{ user_id: string; name: string }>;
    const ownerStaff = staff.find((item) => item.user_id === actorUserId) ?? staff[0];
    expect(ownerStaff?.user_id).toBeTruthy();
    const timezone = String(availabilityPayload.result?.timezone ?? "");
    expect(timezone).toBeTruthy();
    const attemptOffset = testInfo.retry;
    const target = workspaceLocalDate(timezone, 8 + attemptOffset);
    const leave = workspaceLocalDate(timezone, 9 + attemptOffset);
    const targetDate = target.iso;
    const leaveDate = leave.iso;
    const currentWeekday = target.weekday;
    const currentWeekdayLabel = target.weekdayLabel;

    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    await page.getByLabel("Main navigation").getByRole("link", { name: "Availability", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Availability", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    await page.getByLabel("Main navigation").getByRole("link", { name: "Availability", exact: true }).click();
    await refreshAndWait(page, /\/api\/calendar\/availability(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Availability", exact: true })).toBeVisible();
    const staffSelect = page.getByRole("combobox", { name: "Staff", exact: true });
    await expect(staffSelect).toBeVisible();
    await staffSelect.selectOption(ownerStaff.user_id);

    const hoursRow = page.getByRole("group", {
      name: `${currentWeekdayLabel} working hours`,
      exact: true,
    });
    const working = hoursRow.getByRole("checkbox", { name: "Working", exact: true });
    if (!(await working.isChecked())) await working.check();
    await hoursRow.getByLabel(`${currentWeekdayLabel} start time`, { exact: true }).fill("08:00");
    await hoursRow.getByLabel(`${currentWeekdayLabel} end time`, { exact: true }).fill("18:00");
    await hoursRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(currentWeekdayLabel + " working hours saved.")).toBeVisible();

    const breakForm = page.getByRole("form", { name: "Recurring breaks", exact: true });
    await breakForm.getByRole("combobox", { name: "Day", exact: true }).selectOption(String(currentWeekday));
    await breakForm.getByLabel("Label", { exact: true }).fill(temporaryBreak);
    await breakForm.getByLabel("Starts", { exact: true }).fill("16:15");
    await breakForm.getByLabel("Ends", { exact: true }).fill("16:30");
    await breakForm.getByRole("button", { name: "Add break" }).click();
    await expect(page.getByText("Staff break created.")).toBeVisible();

    await page.getByRole("button", { name: `Edit break ${temporaryBreak}`, exact: true }).click();
    await breakForm.getByLabel("Label", { exact: true }).fill(cancelledBreakEdit);
    await breakForm.getByRole("button", { name: "Cancel edit", exact: true }).click();
    await expect(page.getByText(temporaryBreak, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Edit break ${temporaryBreak}`, exact: true }).click();
    await breakForm.getByLabel("Label", { exact: true }).fill(editedBreak);
    await breakForm.getByRole("button", { name: "Save break", exact: true }).click();
    await expect(page.getByText("Staff break updated.")).toBeVisible();
    await page.getByRole("button", { name: `Archive break ${editedBreak}`, exact: true }).click();
    await expect(page.getByText("Staff break archived.")).toBeVisible();

    await breakForm.getByRole("combobox", { name: "Day", exact: true }).selectOption(String(currentWeekday));
    await breakForm.getByLabel("Label", { exact: true }).fill(lunchBreak);
    await breakForm.getByLabel("Starts", { exact: true }).fill("12:00");
    await breakForm.getByLabel("Ends", { exact: true }).fill("13:00");
    await breakForm.getByRole("button", { name: "Add break" }).click();
    await expect(page.getByText("Staff break created.")).toBeVisible();

    const leaveForm = page.getByRole("form", { name: "Leave and time off", exact: true });
    await leaveForm.getByLabel("Starts", { exact: true }).fill(leaveDate + "T09:00");
    await leaveForm.getByLabel("Ends", { exact: true }).fill(leaveDate + "T10:00");
    await leaveForm.getByLabel("Reason", { exact: true }).fill(leaveReason);
    await leaveForm.getByRole("button", { name: "Record leave" }).click();
    await expect(page.getByText("Staff leave recorded.")).toBeVisible();

    await page.getByRole("button", { name: `Edit leave ${leaveReason}`, exact: true }).click();
    await leaveForm.getByLabel("Reason", { exact: true }).fill(cancelledLeaveReason);
    await leaveForm.getByRole("button", { name: "Cancel edit", exact: true }).click();
    await expect(page.getByText(leaveReason, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Edit leave ${leaveReason}`, exact: true }).click();
    await leaveForm.getByLabel("Reason", { exact: true }).fill(updatedLeaveReason);
    await leaveForm.getByRole("button", { name: "Save leave", exact: true }).click();
    await expect(page.getByText("Staff leave updated.")).toBeVisible();
    await page.getByRole("button", { name: `Cancel leave ${updatedLeaveReason}`, exact: true }).click();
    await expect(page.getByText("Staff leave cancelled.")).toBeVisible();

    const roomForm = page.getByRole("form", { name: "Rooms and resources", exact: true });
    await roomForm.getByLabel("Code", { exact: true }).fill(roomCode);
    await roomForm.getByLabel("Name", { exact: true }).fill(roomName);
    await roomForm.getByLabel("Description", { exact: true }).fill("Calendar operational acceptance");
    await roomForm.getByRole("button", { name: "Create room" }).click();
    await expect(page.getByText("Room created.")).toBeVisible();

    await page.getByRole("button", { name: `Edit room ${roomName}`, exact: true }).click();
    await page.getByRole("textbox", { name: "Description", exact: true }).fill("Calendar cancelled room edit");
    await roomForm.getByRole("button", { name: "Cancel edit", exact: true }).click();
    await expect(page.getByText(roomName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Edit room ${roomName}`, exact: true }).click();
    await page.getByRole("textbox", { name: "Description", exact: true }).fill("Calendar acceptance updated");
    await roomForm.getByRole("button", { name: "Save room", exact: true }).click();
    await expect(page.getByText("Room updated.")).toBeVisible();
    await page.getByRole("button", { name: `Archive room ${roomName}`, exact: true }).click();
    await expect(page.getByText("Room archived.")).toBeVisible();
    await page.getByRole("button", { name: `Restore room ${roomName}`, exact: true }).click();
    await expect(page.getByText("Room restored.")).toBeVisible();

    await refreshAndWait(page, /\/api\/calendar\/availability(?:\?|$)/);
    await expect(page.getByText(lunchBreak, { exact: true })).toBeVisible();
    await expect(page.getByText(roomName, { exact: true })).toBeVisible();
    await expect(page.getByText("No active leave recorded.", { exact: true })).toBeVisible();

    try {
      await context.setOffline(true);
      await expect(page.getByText("Online connection required", { exact: true })).toBeVisible();
      await expect(breakForm.getByRole("button", { name: "Add break", exact: true })).toBeDisabled();
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByText("Online connection required", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    await page.getByLabel("Main navigation").getByRole("link", { name: "Service eligibility", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Service eligibility", exact: true })).toBeVisible();
    await refreshAndWait(page, /\/api\/calendar\/eligibility(?:\?|$)/);
    await page.getByRole("combobox", { name: "Active Service", exact: true }).selectOption(serviceId);
    const staffRow = page.getByRole("group", {
      name: `Service eligibility for ${ownerStaff.name}`,
      exact: true,
    });
    await staffRow.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText(ownerStaff.name + " can now perform " + serviceName + ".")).toBeVisible();
    await staffRow.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText(ownerStaff.name + " was removed from " + serviceName + ".")).toBeVisible();
    await staffRow.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText(ownerStaff.name + " can now perform " + serviceName + ".")).toBeVisible();
    try {
      await context.setOffline(true);
      await expect(page.getByText("Online connection required", { exact: true })).toBeVisible();
      await expect(staffRow.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByText("Online connection required", { exact: true })).toHaveCount(0);
    await refreshAndWait(page, /\/api\/calendar\/eligibility(?:\?|$)/);
    await expect(staffRow.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    await expect(page.locator('a[href="/calendar/timesheets"]')).toHaveCount(0);
    await expect(page.locator('a[href="/calendar/meetings"]')).toHaveCount(0);
    await expect(page.getByLabel("Main navigation").getByRole("link", { name: "Availability", exact: true })).toBeVisible();
    await expect(page.getByLabel("Main navigation").getByRole("link", { name: "Service eligibility", exact: true })).toBeVisible();
    await refreshAndWait(page, /\/api\/appointments(?:\?|$)/);
    const agendaHeading = page
      .getByRole("group", { name: "Day agenda", exact: true })
      .getByRole("heading", { level: 2 });
    const todayAgenda = (await agendaHeading.textContent())?.trim() ?? "";
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    expect((await agendaHeading.textContent())?.trim()).not.toBe(todayAgenda);
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    expect((await agendaHeading.textContent())?.trim()).toBe(todayAgenda);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    expect((await agendaHeading.textContent())?.trim()).toBe(todayAgenda);
    await expect(page.getByRole("button", { name: "New appointment", exact: true })).toBeEnabled();

    await openAppointmentForm(page, {
      customerId, serviceId, staffUserId: ownerStaff.user_id, date: targetDate,
      time: "07:30", roomName, notes: "Outside hours acceptance",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText(/does not fit inside the staff member's configured working hours/i)).toBeVisible();
    await discardRejectedCalendarCommand(page);

    await openAppointmentForm(page, {
      customerId, serviceId, staffUserId: ownerStaff.user_id, date: targetDate,
      time: "12:15", roomName, notes: "Break conflict acceptance",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText(/overlaps a configured staff break/i)).toBeVisible();
    await discardRejectedCalendarCommand(page);

    await openAppointmentForm(page, {
      customerId, serviceId, staffUserId: ownerStaff.user_id, date: targetDate,
      time: "10:00", roomName, notes: "Lifecycle acceptance", initialStatus: "pending", channel: "phone",
    });
    await page.getByRole("button", { name: "Create appointment", exact: true }).click();
    await expect(page.getByText("Appointment created.")).toBeVisible();

    const search = page.getByRole("textbox", { name: "Search appointments", exact: true });
    let lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "10:00" });
    await search.fill(customerName);
    await expect(lifecycleAppointment).toBeVisible();
    await search.fill("no-such-calendar-record");
    await expect(page.getByText("No Appointments match", { exact: true })).toBeVisible();
    await search.fill("");
    await page.getByRole("button", { name: "Pending", exact: true }).click();
    await expect(lifecycleAppointment).toBeVisible();
    await page.getByRole("button", { name: "Confirmed", exact: true }).click();
    await expect(lifecycleAppointment).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "10:00" });
    await lifecycleAppointment.click();
    const detailDialog = page.getByRole("dialog", { name: new RegExp(customerName) });
    await expect(detailDialog).toBeVisible();
    await detailDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(lifecycleAppointment).toBeVisible();

    await openAppointmentForm(page, {
      customerId, serviceId, staffUserId: ownerStaff.user_id, date: targetDate,
      time: "10:15", roomName, notes: "Overlap acceptance", initialStatus: "confirmed",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText(/already has an Appointment|room already has an Appointment/i)).toBeVisible();
    await discardRejectedCalendarCommand(page);

    await page.getByLabel("Main navigation").getByRole("link", { name: "Service eligibility", exact: true }).click();
    await page.getByRole("combobox", { name: "Active Service", exact: true }).selectOption(serviceId);
    await staffRow.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(/Reschedule or cancel existing Appointments/i)).toBeVisible();

    await page.getByRole("button", { name: "Back to Calendar", exact: true }).click();
    lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "10:00" });
    await lifecycleAppointment.click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("Appointment confirmed.")).toBeVisible();
    await page.getByRole("button", { name: "Confirmed", exact: true }).click();
    await expect(page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "10:00" })).toBeVisible();
    await page.getByRole("button", { name: "All", exact: true }).click();

    lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "10:00" });
    await lifecycleAppointment.click();
    await page.getByRole("button", { name: "Reschedule", exact: true }).click();
    await page.getByLabel("Start time", { exact: true }).fill("11:00");
    await page.getByRole("button", { name: "Save reschedule" }).click();
    await expect(page.getByText("Appointment rescheduled.")).toBeVisible();

    await openAppointmentForm(page, {
      customerId, serviceId, staffUserId: ownerStaff.user_id, date: targetDate,
      time: "14:00", roomName, notes: "Cancellation acceptance", initialStatus: "confirmed",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText("Appointment created.")).toBeVisible();
    const cancellationAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "14:00" });
    await cancellationAppointment.click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Keep appointment", exact: true }).click();
    await expect(page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "14:00" })).toBeVisible();
    await cancellationAppointment.click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByLabel("Cancellation reason", { exact: true }).fill("Operational acceptance cancellation");
    await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
    await expect(page.getByText("Appointment cancelled.")).toBeVisible();

    lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "11:00" });
    await lifecycleAppointment.click();
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(page.getByText("Appointment completed.")).toBeVisible();
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "11:00" })).toBeVisible();
    await page.getByRole("button", { name: "Cancelled", exact: true }).click();
    await expect(page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "14:00" })).toBeVisible();
    await page.getByRole("button", { name: "All", exact: true }).click();

    const queueKey = "bdb-appointment-queue-v2:" + actorUserId + ":" + workspaceId;
    try {
      await context.setOffline(true);
      await expect(page.getByText("Offline", { exact: true })).toBeVisible();
      await openAppointmentForm(page, {
        customerId, serviceId, staffUserId: ownerStaff.user_id, date: targetDate,
        time: "15:30", roomName, notes: "Offline replay acceptance", initialStatus: "confirmed",
      });
      await page.getByRole("button", { name: "Save offline" }).click();
      await expect(page.getByText(/Saved offline/i)).toBeVisible();
      await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").length, queueKey)).toBe(1);
    } finally {
      await context.setOffline(false);
    }

    await expect.poll(
      async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").length, queueKey),
      { timeout: 30_000 },
    ).toBe(0);
    await expect(page.getByText(/queued Appointment change synced/i)).toBeVisible();
    await refreshAndWait(page, /\/api\/appointments(?:\?|$)/);

    const appointmentsResponse = await page.request.get("/api/appointments?workspaceId=" + encodeURIComponent(workspaceId));
    expect(appointmentsResponse.ok()).toBeTruthy();
    const appointmentsPayload = await appointmentsResponse.json();
    expect(appointmentsPayload.ok).toBe(true);
    const appointments = (appointmentsPayload.result?.appointments ?? []) as Array<{
      booking_date: string;
      booking_time: string;
      notes: string | null;
      status: string;
    }>;
    const accepted = appointments.filter((item) => item.booking_date === targetDate);
    expect(accepted.some((item) => item.notes === "Lifecycle acceptance" && item.status === "completed" && item.booking_time.startsWith("11:00"))).toBe(true);
    expect(accepted.some((item) => item.notes === "Cancellation acceptance" && item.status === "cancelled")).toBe(true);
    expect(accepted.some((item) => item.notes === "Offline replay acceptance" && item.status === "confirmed")).toBe(true);
  });
});

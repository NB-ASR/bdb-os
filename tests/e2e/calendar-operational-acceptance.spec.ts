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

function nextWeekdayIso(targetDay: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  let days = (targetDay - date.getUTCDay() + 7) % 7;
  if (days < 7) days += 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addDaysIso(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  },
) {
  await page.getByRole("button", { name: "New appointment" }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption(values.customerId);
  await page.getByLabel("Service", { exact: true }).selectOption(values.serviceId);
  await expect(page.getByLabel("Staff member", { exact: true })).toHaveValue(values.staffUserId);
  await page.getByLabel("Date", { exact: true }).fill(values.date);
  await page.getByLabel("Start time", { exact: true }).fill(values.time);
  await page.getByLabel("Room", { exact: true }).selectOption({ label: new RegExp(values.roomName) });
  await page.getByLabel("Appointment notes", { exact: true }).fill(values.notes);
  if (values.initialStatus) {
    await page.getByLabel("Initial status", { exact: true }).selectOption(values.initialStatus);
  }
}

test.describe("Calendar V1 operational acceptance", () => {
  test.skip(!email || !password, "Dedicated E2E owner credentials are not configured.");

  test("Calendar V1 is operational for an authenticated owner", async ({ page, context }) => {
    test.setTimeout(240_000);
    await signIn(page);
    if (workspaceName) {
      await expect(page.getByRole("heading", { name: new RegExp(workspaceName, "i") })).toBeVisible();
    }

    const { workspaceId, actorUserId } = await workspaceContext(page);
    const unique = Date.now();
    const customerId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    const customerName = "Calendar Acceptance Customer " + unique;
    const serviceName = "Calendar Acceptance Service " + unique;
    const serviceCode = "CAL-" + String(unique).slice(-8);
    const roomCode = "ROOM-" + String(unique).slice(-6);
    const roomName = "Calendar Acceptance Room " + unique;
    const targetDate = nextWeekdayIso(1);
    const leaveDate = addDaysIso(targetDate, 7);

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

    await page.goto("/calendar/availability");
    await expect(page.getByRole("heading", { name: "Availability", exact: true })).toBeVisible();
    await page.getByLabel("Staff", { exact: true }).selectOption(ownerStaff.user_id);

    const mondayRow = page.getByText("Monday", { exact: true }).locator("xpath=..");
    const working = mondayRow.locator('input[type="checkbox"]');
    if (!(await working.isChecked())) await working.check();
    const mondayTimes = mondayRow.locator('input[type="time"]');
    await mondayTimes.nth(0).fill("08:00");
    await mondayTimes.nth(1).fill("18:00");
    await mondayRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Monday working hours saved.")).toBeVisible();

    const breakForm = page.getByRole("button", { name: "Add break" }).locator("xpath=ancestor::form");
    await breakForm.getByLabel("Day", { exact: true }).selectOption("1");
    await breakForm.getByLabel("Label", { exact: true }).fill("Acceptance temporary break");
    await breakForm.getByLabel("Starts", { exact: true }).fill("16:15");
    await breakForm.getByLabel("Ends", { exact: true }).fill("16:30");
    await breakForm.getByRole("button", { name: "Add break" }).click();
    await expect(page.getByText("Staff break created.")).toBeVisible();

    let breakRow = page.getByText("Acceptance temporary break", { exact: true }).locator("xpath=../..");
    await breakRow.getByRole("button").nth(0).click();
    await breakForm.getByLabel("Label", { exact: true }).fill("Acceptance edited break");
    await breakForm.getByRole("button", { name: "Save break" }).click();
    await expect(page.getByText("Staff break updated.")).toBeVisible();
    breakRow = page.getByText("Acceptance edited break", { exact: true }).locator("xpath=../..");
    await breakRow.getByRole("button").nth(1).click();
    await expect(page.getByText("Staff break archived.")).toBeVisible();

    await breakForm.getByLabel("Day", { exact: true }).selectOption("1");
    await breakForm.getByLabel("Label", { exact: true }).fill("Acceptance lunch");
    await breakForm.getByLabel("Starts", { exact: true }).fill("12:00");
    await breakForm.getByLabel("Ends", { exact: true }).fill("13:00");
    await breakForm.getByRole("button", { name: "Add break" }).click();
    await expect(page.getByText("Staff break created.")).toBeVisible();

    const leaveForm = page.getByRole("button", { name: "Record leave" }).locator("xpath=ancestor::form");
    await leaveForm.getByLabel("Starts", { exact: true }).fill(leaveDate + "T09:00");
    await leaveForm.getByLabel("Ends", { exact: true }).fill(leaveDate + "T10:00");
    await leaveForm.getByLabel("Reason", { exact: true }).fill("Acceptance leave");
    await leaveForm.getByRole("button", { name: "Record leave" }).click();
    await expect(page.getByText("Staff leave recorded.")).toBeVisible();

    let leaveRow = page.getByText("Acceptance leave", { exact: true }).locator("xpath=../..");
    await leaveRow.getByRole("button").nth(0).click();
    await leaveForm.getByLabel("Reason", { exact: true }).fill("Acceptance leave updated");
    await leaveForm.getByRole("button", { name: "Save leave" }).click();
    await expect(page.getByText("Staff leave updated.")).toBeVisible();
    leaveRow = page.getByText("Acceptance leave updated", { exact: true }).locator("xpath=../..");
    await leaveRow.getByRole("button").nth(1).click();
    await expect(page.getByText("Staff leave cancelled.")).toBeVisible();

    const roomForm = page.getByRole("button", { name: "Create room" }).locator("xpath=ancestor::form");
    await roomForm.getByLabel("Code", { exact: true }).fill(roomCode);
    await roomForm.getByLabel("Name", { exact: true }).fill(roomName);
    await roomForm.getByLabel("Description", { exact: true }).fill("Calendar operational acceptance");
    await roomForm.getByRole("button", { name: "Create room" }).click();
    await expect(page.getByText("Room created.")).toBeVisible();

    let roomRow = page.getByText(roomName, { exact: true }).locator("xpath=../../..");
    await roomRow.getByRole("button").nth(0).click();
    await roomForm.getByLabel("Description", { exact: true }).fill("Calendar acceptance updated");
    await roomForm.getByRole("button", { name: "Save room" }).click();
    await expect(page.getByText("Room updated.")).toBeVisible();
    roomRow = page.getByText(roomName, { exact: true }).locator("xpath=../../..");
    await roomRow.getByRole("button").nth(1).click();
    await expect(page.getByText("Room archived.")).toBeVisible();
    roomRow = page.getByText(roomName, { exact: true }).locator("xpath=../../..");
    await roomRow.getByRole("button").nth(1).click();
    await expect(page.getByText("Room restored.")).toBeVisible();

    await page.goto("/calendar/eligibility");
    await expect(page.getByRole("heading", { name: "Service eligibility", exact: true })).toBeVisible();
    await page.getByLabel("Active Service", { exact: true }).selectOption(serviceId);
    const staffRow = page.getByText(ownerStaff.name, { exact: true }).locator("xpath=../../..");
    await staffRow.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText(ownerStaff.name + " can now perform " + serviceName + ".")).toBeVisible();
    await staffRow.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(ownerStaff.name + " was removed from " + serviceName + ".")).toBeVisible();
    await staffRow.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText(ownerStaff.name + " can now perform " + serviceName + ".")).toBeVisible();

    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
    await expect(page.locator('a[href="/calendar/meetings"]')).toHaveCount(0);
    await expect(page.locator('a[href="/calendar/timesheets"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New appointment" })).toBeEnabled();

    await openAppointmentForm(page, {
      customerId,
      serviceId,
      staffUserId: ownerStaff.user_id,
      date: targetDate,
      time: "07:30",
      roomName,
      notes: "Outside hours acceptance",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText(/does not fit inside the staff member's configured working hours/i)).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: "Discard rejected change", exact: true }).click();
    await expect(page.getByText("The confirmed rejected Appointment change was discarded.")).toBeVisible();

    await openAppointmentForm(page, {
      customerId,
      serviceId,
      staffUserId: ownerStaff.user_id,
      date: targetDate,
      time: "12:15",
      roomName,
      notes: "Break conflict acceptance",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText(/overlaps a configured staff break/i)).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("button", { name: "Discard rejected change", exact: true }).click();
    await expect(page.getByText("The confirmed rejected Appointment change was discarded.")).toBeVisible();

    await openAppointmentForm(page, {
      customerId,
      serviceId,
      staffUserId: ownerStaff.user_id,
      date: targetDate,
      time: "10:00",
      roomName,
      notes: "Lifecycle acceptance",
      initialStatus: "pending",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText("Appointment created.")).toBeVisible();

    let lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "10:00" }).first();
    await expect(lifecycleAppointment).toBeVisible();
    await lifecycleAppointment.click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByText("Appointment confirmed.")).toBeVisible();

    lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "10:00" }).first();
    await lifecycleAppointment.click();
    await page.getByRole("button", { name: "Reschedule", exact: true }).click();
    await page.getByLabel("Start time", { exact: true }).fill("11:00");
    await page.getByRole("button", { name: "Save reschedule" }).click();
    await expect(page.getByText("Appointment rescheduled.")).toBeVisible();

    await openAppointmentForm(page, {
      customerId,
      serviceId,
      staffUserId: ownerStaff.user_id,
      date: targetDate,
      time: "14:00",
      roomName,
      notes: "Cancellation acceptance",
      initialStatus: "confirmed",
    });
    await page.getByRole("button", { name: "Create appointment" }).click();
    await expect(page.getByText("Appointment created.")).toBeVisible();
    const cancellationAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "14:00" }).first();
    await cancellationAppointment.click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByLabel("Cancellation reason", { exact: true }).fill("Operational acceptance cancellation");
    await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
    await expect(page.getByText("Appointment cancelled.")).toBeVisible();

    lifecycleAppointment = page.getByRole("button").filter({ hasText: customerName }).filter({ hasText: "11:00" }).first();
    await lifecycleAppointment.click();
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(page.getByText("Appointment completed.")).toBeVisible();

    const queueKey = "bdb-appointment-queue-v2:" + actorUserId + ":" + workspaceId;
    try {
      await context.setOffline(true);
      await expect(page.getByText("Offline", { exact: true })).toBeVisible();
      await openAppointmentForm(page, {
        customerId,
        serviceId,
        staffUserId: ownerStaff.user_id,
        date: targetDate,
        time: "15:30",
        roomName,
        notes: "Offline replay acceptance",
        initialStatus: "confirmed",
      });
      await page.getByRole("button", { name: "Save offline" }).click();
      await expect(page.getByText(/Saved offline/i)).toBeVisible();
      await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").length, queueKey)).toBe(1);
    } finally {
      await context.setOffline(false);
    }
    await expect.poll(async () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").length, queueKey), { timeout: 30_000 }).toBe(0);

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
    const accepted = appointments.filter((item) => item.booking_date === targetDate && item.notes?.includes("acceptance"));
    expect(accepted.some((item) => item.notes === "Lifecycle acceptance" && item.status === "completed" && item.booking_time.startsWith("11:00"))).toBe(true);
    expect(accepted.some((item) => item.notes === "Cancellation acceptance" && item.status === "cancelled")).toBe(true);
    expect(accepted.some((item) => item.notes === "Offline replay acceptance" && item.status === "confirmed")).toBe(true);
  });
});

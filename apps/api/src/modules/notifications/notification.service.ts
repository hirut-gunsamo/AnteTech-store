import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import { getSettings } from "../settings/settings.service.js";
import { getLowStock } from "../reports/report.service.js";

/**
 * What needs this person's attention right now.
 *
 * Derived from live data rather than stored as events. A notification here is
 * a piece of current state — "three requests are waiting on you" — so acting
 * on the thing makes the notification disappear by itself. There is no read
 * flag to keep in step and no way for the badge to lie.
 *
 * Everything is scoped exactly as the matching page is: the Owner counts every
 * store, a salesperson their own store and their own work.
 */

export type NotificationKind =
  | "REQUESTS_TO_DECIDE"
  | "REPORTS_TO_APPROVE"
  | "RECEIPTS_TO_VERIFY"
  | "MY_REQUEST_APPROVED"
  | "MY_REQUEST_REJECTED"
  | "DELIVERIES_TO_RECEIVE"
  | "TRANSFERS_DONE"
  | "LOW_STOCK"
  | "EXPENSES_ADDED";

export type Notification = {
  kind: NotificationKind;
  count: number;
  /** "action" needs a decision from this person; "warn" is a heads-up. */
  tone: "action" | "warn";
  href: string;
  /** A few names for context, where naming them helps. */
  sample: string[];
  /**
   * When the newest item of this kind reached this person, and who sent it.
   * The client pops up a notice when this moves forward, which catches a new
   * arrival even if another was dealt with in the same poll and the count
   * stayed the same.
   */
  latest?: { at: string; by: string };
};

function latestOf(row: { at: Date | null; by: { name: string } } | null) {
  return row?.at ? { at: row.at.toISOString(), by: row.by.name } : undefined;
}

/** How long a decided request keeps showing if the Requests page is never opened. */
const DECIDED_SHOWN_FOR_MS = 3 * 24 * 60 * 60 * 1000;

export async function getNotifications(
  viewer: Viewer,
  // When this person last opened the Requests or Transfers page. Decisions
  // and arrivals from before it have been seen, so they stop showing.
  options: {
    requestsSeenAt?: Date;
    transfersSeenAt?: Date;
    expensesSeenAt?: Date;
  } = {},
) {
  const settings = await getSettings();
  const out: Notification[] = [];

  const isOwner = viewer.role === "OWNER";
  const floor = new Date(Date.now() - DECIDED_SHOWN_FOR_MS);
  const sinceSeen = (seen?: Date) => (seen && seen > floor ? seen : floor);

  // Restock requests from the stores, waiting on the Owner.
  if (settings.notifyRequests && isOwner) {
    const waiting = await prisma.stockRequest.findMany({
      where: { status: "PENDING", requestedToId: viewer.userId },
      select: { submittedAt: true, requestedBy: { select: { name: true } } },
      // Newest first, so the sample and `latest` name the newest sender.
      orderBy: { submittedAt: "desc" },
      take: 60,
    });

    if (waiting.length > 0) {
      out.push({
        kind: "REQUESTS_TO_DECIDE",
        count: waiting.length,
        tone: "action",
        href: "/approvals",
        sample: waiting.slice(0, 3).map((r) => r.requestedBy.name),
        latest: latestOf({ at: waiting[0].submittedAt, by: waiting[0].requestedBy }),
      });
    }
  }

  // Cash reports and bank receipts the sellers submitted for checking.
  if (settings.notifyApprovals && isOwner) {
    const reportWhere = { status: "SUBMITTED" as const };
    const receiptWhere = { status: "PENDING" as const };

    const [reports, receipts, newReport, newReceipt] = await Promise.all([
      prisma.cashReport.count({ where: reportWhere }),
      prisma.bankReceipt.count({ where: receiptWhere }),
      prisma.cashReport.findFirst({
        where: reportWhere,
        // Postgres sorts NULLs first when descending; an old row missing its
        // timestamp must not hide the newest one.
        orderBy: { submittedAt: { sort: "desc", nulls: "last" } },
        select: { submittedAt: true, salesperson: { select: { name: true } } },
      }),
      prisma.bankReceipt.findFirst({
        where: receiptWhere,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, uploadedBy: { select: { name: true } } },
      }),
    ]);

    if (reports > 0) {
      out.push({
        kind: "REPORTS_TO_APPROVE",
        count: reports,
        tone: "action",
        href: "/approvals",
        sample: [],
        latest: latestOf(newReport && { at: newReport.submittedAt, by: newReport.salesperson }),
      });
    }

    if (receipts > 0) {
      out.push({
        kind: "RECEIPTS_TO_VERIFY",
        count: receipts,
        tone: "action",
        href: "/receipts",
        sample: [],
        latest: latestOf(newReceipt && { at: newReceipt.createdAt, by: newReceipt.uploadedBy }),
      });
    }
  }

  // Goods on the road to this seller's store: someone there presses Received
  // once they arrive, which is when the stock is counted in.
  if (viewer.role === "SALES" && viewer.branchId) {
    const incoming = await prisma.stockTransfer.findMany({
      where: { status: "IN_TRANSIT", toLocationId: viewer.branchId },
      select: {
        shippedAt: true,
        driverName: true,
        fromLocation: { select: { name: true } },
        deliveredBy: { select: { name: true } },
      },
      orderBy: { shippedAt: "desc" },
    });

    if (incoming.length > 0) {
      out.push({
        kind: "DELIVERIES_TO_RECEIVE",
        count: incoming.length,
        tone: "action",
        href: "/transfers",
        sample: incoming
          .slice(0, 3)
          .map((row) => row.fromLocation.name + (row.driverName ? ` · ${row.driverName}` : "")),
        latest: incoming[0].shippedAt
          ? { at: incoming[0].shippedAt.toISOString(), by: incoming[0].deliveredBy?.name ?? "" }
          : undefined,
      });
    }
  }

  // A transfer finished: the goods arrived and were counted in. Shown to the
  // Owner until Transfers is opened, or for three days.
  if (isOwner) {
    const done = await prisma.stockTransfer.findMany({
      where: { status: "RECEIVED", receivedAt: { gt: sinceSeen(options.transfersSeenAt) } },
      select: {
        receivedAt: true,
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        receivedBy: { select: { name: true } },
      },
      orderBy: { receivedAt: "desc" },
    });

    if (done.length > 0) {
      out.push({
        kind: "TRANSFERS_DONE",
        count: done.length,
        tone: "warn",
        href: "/transfers",
        sample: done.slice(0, 3).map((row) => `${row.fromLocation.name} → ${row.toLocation.name}`),
        latest: done[0].receivedAt
          ? { at: done[0].receivedAt.toISOString(), by: done[0].receivedBy?.name ?? "" }
          : undefined,
      });
    }
  }

  // A seller hearing back about their own restock request. Shown until they
  // open the Requests page, or for three days.
  if (viewer.role === "SALES") {
    const decided = await prisma.stockRequest.findMany({
      where: {
        requestedById: viewer.userId,
        status: { in: ["APPROVED", "FULFILLED", "REJECTED"] },
        reviewedAt: { gt: sinceSeen(options.requestsSeenAt) },
      },
      select: {
        status: true,
        reviewedAt: true,
        rejectionReason: true,
        approvedBy: { select: { name: true } },
      },
      orderBy: { reviewedAt: "desc" },
    });

    const approved = decided.filter((row) => row.status !== "REJECTED");
    const rejected = decided.filter((row) => row.status === "REJECTED");
    const latest = (row: (typeof decided)[number] | undefined) =>
      row?.reviewedAt
        ? { at: row.reviewedAt.toISOString(), by: row.approvedBy?.name ?? "" }
        : undefined;

    if (approved.length > 0) {
      out.push({
        kind: "MY_REQUEST_APPROVED",
        count: approved.length,
        tone: "action",
        href: "/requests",
        sample: [],
        latest: latest(approved[0]),
      });
    }

    if (rejected.length > 0) {
      out.push({
        kind: "MY_REQUEST_REJECTED",
        count: rejected.length,
        tone: "action",
        href: "/requests",
        // The reason is the useful part: it says what to do next.
        sample: rejected
          .map((row) => row.rejectionReason ?? "")
          .filter(Boolean)
          .slice(0, 2),
        latest: latest(rejected[0]),
      });
    }
  }

  if (settings.notifyLowStock) {
    // Same rule and the same scoping the dashboard uses, so the two can never
    // disagree about what counts as low.
    const low = await getLowStock(viewer, 20);

    if (low.length > 0) {
      out.push({
        kind: "LOW_STOCK",
        count: low.length,
        tone: "warn",
        href: "/inventory",
        // The Owner sees the same product low at several stores, so the
        // store is what tells those rows apart.
        sample: low
          .slice(0, 3)
          .map((row) => (isOwner ? `${row.name} · ${row.branch}` : row.name)),
      });
    }
  }

  // Expenses the stores' sellers recorded since the Owner last opened
  // Expenses. The Owner's own entries are not news to the Owner.
  if (isOwner) {
    const added = await prisma.expense.findMany({
      where: {
        createdAt: { gt: sinceSeen(options.expensesSeenAt) },
        recordedById: { not: viewer.userId },
      },
      select: {
        createdAt: true,
        amount: true,
        reason: true,
        location: { select: { name: true } },
        recordedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (added.length > 0) {
      out.push({
        kind: "EXPENSES_ADDED",
        count: added.length,
        tone: "warn",
        href: "/expenses",
        sample: added
          .slice(0, 3)
          .map((row) => `${row.location.name} · ${row.reason} · ${Number(row.amount)}`),
        latest: { at: added[0].createdAt.toISOString(), by: added[0].recordedBy.name },
      });
    }
  }

  return {
    notifications: out,
    // Things needing a decision drive the badge; warnings are shown but do
    // not nag, so a permanently low shelf does not sit on a red dot forever.
    actionCount: out
      .filter((item) => item.tone === "action")
      .reduce((sum, item) => sum + item.count, 0),
    total: out.reduce((sum, item) => sum + item.count, 0),
  };
}

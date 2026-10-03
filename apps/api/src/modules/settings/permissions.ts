/**
 * What each role may do, per module.
 *
 * This is documentation of the guards that are actually in place, kept beside
 * them so the Settings page cannot drift into describing a system that does
 * not exist. It is deliberately READ-ONLY: the routes enforce access with
 * `authorize(...)` at the module level, so making this editable would mean
 * every guard consulting the database on every request. That is a
 * security-critical change and needs its own design pass, not a checkbox.
 */

export type Ability = {
  action: string;
  owner: boolean;
  sales: boolean;
  /** Anything the role check alone does not tell you. */
  note?: string;
};

export type PermissionModule = {
  module: string;
  abilities: Ability[];
};

export const PERMISSION_MATRIX: PermissionModule[] = [
  {
    module: "Inventory",
    abilities: [
      {
        action: "View stock",
        owner: true,
        sales: true,
        note: "Sellers see only their own store",
      },
      {
        action: "Add stock",
        owner: true,
        sales: false,
        note: "Only into the main store",
      },
      { action: "Correct a balance", owner: true, sales: false },
      { action: "Delete a stock row", owner: true, sales: false },
    ],
  },
  {
    module: "Transfers",
    abilities: [
      {
        action: "Send goods between stores",
        owner: true,
        sales: false,
        note: "From the main store or from another selling store",
      },
      {
        action: "Confirm goods received",
        owner: true,
        sales: true,
        note: "Sellers confirm deliveries to their own store",
      },
    ],
  },
  {
    module: "Sales",
    abilities: [
      {
        action: "View sales",
        owner: true,
        sales: true,
        note: "Sellers see their own",
      },
      {
        action: "Record a sale",
        owner: false,
        sales: true,
        note: "Phones and devices need an IMEI or serial per unit",
      },
    ],
  },
  {
    module: "Restock requests",
    abilities: [
      { action: "View requests", owner: true, sales: true, note: "Sellers see their own" },
      { action: "Raise a request", owner: false, sales: true },
      {
        action: "Approve or reject",
        owner: true,
        sales: false,
        note: "Approving names the source store and sends the goods",
      },
      { action: "Cancel a pending request", owner: true, sales: true },
    ],
  },
  {
    module: "Cash reports",
    abilities: [
      { action: "View reports", owner: true, sales: true },
      { action: "Reconcile a period", owner: false, sales: true },
      { action: "Approve or reject", owner: true, sales: false },
    ],
  },
  {
    module: "Bank receipts",
    abilities: [
      { action: "View receipts", owner: true, sales: true },
      {
        action: "Record a deposit",
        owner: true,
        sales: true,
        note: "The slip is optional",
      },
      { action: "Verify or reject", owner: true, sales: false },
    ],
  },
  {
    module: "Stores",
    abilities: [
      { action: "View stores", owner: true, sales: true, note: "Sellers see their own and the main store" },
      { action: "Add or rename a selling store", owner: true, sales: false },
      {
        action: "Open, close or delete",
        owner: true,
        sales: false,
        note: "The main store is never closed or deleted",
      },
    ],
  },
  {
    module: "Users",
    abilities: [
      { action: "View staff", owner: true, sales: false },
      { action: "Add or edit a seller", owner: true, sales: false },
      { action: "Move between stores", owner: true, sales: false },
      {
        action: "Edit own profile and password",
        owner: true,
        sales: true,
        note: "Role, store and active status are ignored, so nobody can promote themselves",
      },
    ],
  },
  {
    module: "Reports and settings",
    abilities: [
      { action: "View reports", owner: true, sales: true },
      { action: "Read settings", owner: true, sales: true },
      { action: "Change settings", owner: true, sales: false },
      { action: "Back up or restore", owner: true, sales: false },
    ],
  },
];

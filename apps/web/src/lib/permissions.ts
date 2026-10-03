import type { TranslationKey } from './i18n'

/**
 * The permission grid is generated on the server from the same source as the
 * route guards, so its labels arrive as English sentences rather than keys.
 * Rather than teach the API about languages — which would make a security
 * table depend on a display concern — the client looks each label up here.
 *
 * A miss falls back to the server's own wording, so a new ability shows up
 * untranslated instead of blank.
 */
const TEXT: Record<string, TranslationKey> = {
  // Modules
  Inventory: 'perm.modInventory',
  Transfers: 'perm.modTransfers',
  Sales: 'perm.modSales',
  'Restock requests': 'perm.modStockRequests',
  'Cash reports': 'perm.modCashReports',
  'Bank receipts': 'perm.modBankReceipts',
  Stores: 'perm.modBranches',
  Users: 'perm.modUsers',
  'Reports and settings': 'perm.modReportsSettings',

  // Abilities
  'View stock': 'perm.aViewStock',
  'Add stock': 'perm.aAddStock',
  'Correct a balance': 'perm.aCorrectBalance',
  'Delete a stock row': 'perm.aDeleteStockRow',
  'Send goods between stores': 'perm.aSendGoods',
  'Confirm goods received': 'perm.aConfirmReceived',
  'View sales': 'perm.aViewSales',
  'Record a sale': 'perm.aRecordSale',
  'Approve or reject': 'perm.aApproveReject',
  'View requests': 'perm.aViewRequests',
  'Raise a request': 'perm.aRaiseRequest',
  'Cancel a pending request': 'perm.aCancelPending',
  'View reports': 'perm.aViewReports',
  'Reconcile a period': 'perm.aReconcile',
  'View receipts': 'perm.aViewReceipts',
  'Record a deposit': 'perm.aRecordDeposit',
  'Verify or reject': 'perm.aVerifyReject',
  'View stores': 'perm.aViewBranches',
  'Add or rename a selling store': 'perm.aCreateRename',
  'Open, close or delete': 'perm.aOpenCloseDelete',
  'View staff': 'perm.aViewStaff',
  'Add or edit a seller': 'perm.aAddEditUser',
  'Move between stores': 'perm.aMoveBranches',
  'Edit own profile and password': 'perm.aEditOwnProfile',
  'Read settings': 'perm.aReadSettings',
  'Change settings': 'perm.aChangeSettings',
  'Back up or restore': 'perm.aBackupRestore',

  // Notes
  'Sellers see only their own store': 'perm.nOwnBranchOnly',
  'Only into the main store': 'perm.nMainOnly',
  'From the main store or from another selling store': 'perm.nFromMainOrStore',
  'Sellers confirm deliveries to their own store': 'perm.nSellersConfirm',
  'Sellers see their own': 'perm.nSalesSeeOwn',
  'Phones and devices need an IMEI or serial per unit': 'perm.nImeiPerUnit',
  'Approving names the source store and sends the goods': 'perm.nApprovingNames',
  'The slip is optional': 'perm.nSlipOptional',
  'Sellers see their own and the main store': 'perm.nSellersOwnAndMain',
  'The main store is never closed or deleted': 'perm.nMainNeverClosed',
  'Role, store and active status are ignored, so nobody can promote themselves':
    'perm.nSelfEditIgnores',
}

/** Translate one label from the permission endpoint, or pass it through. */
export function permissionText(
  t: (key: TranslationKey) => string,
  label: string,
) {
  const key = TEXT[label]
  return key ? t(key) : label
}

import type { TranslationKey } from './i18n'
import {
  approvedUnitCount,
  isPartlyApproved,
  requestRef,
  requestUnitCount,
} from './requests'
import type {
  BankReceipt,
  CashReport,
  StockRequest,
} from './types'

// The three queues are different records with different endpoints, so the page
// normalises them into one row shape. `kind` decides which endpoint an action
// hits; `source` keeps the original for the details panel.
export type ApprovalKind = 'REQUEST' | 'REPORT' | 'RECEIPT'

export type ApprovalRow = {
  id: string
  kind: ApprovalKind
  reference: string
  date: string
  requestedBy: string
  requestedByRole: string
  branch: string
  typeKey: TranslationKey
  summary: string
  /** PENDING / APPROVED / REJECTED, flattened across the three vocabularies. */
  state: 'PENDING' | 'APPROVED' | 'REJECTED' | 'OTHER'
  decidedAt: string | null
  source: StockRequest | CashReport | BankReceipt
}

export const KIND_LABEL: Record<ApprovalKind, string> = {
  REQUEST: 'Stock Request',
  REPORT: 'Cash Report',
  RECEIPT: 'Bank Receipt',
}

/** The same three as keys, for anything the page shows rather than exports. */
export const KIND_KEY: Record<ApprovalKind, TranslationKey> = {
  REQUEST: 'appr.typeRequest',
  REPORT: 'appr.typeReport',
  RECEIPT: 'appr.typeReceipt',
}

function reportRef(report: CashReport) {
  const date = new Date(report.createdAt)
  const stamp = Number.isNaN(date.getTime())
    ? 'UNKNOWN'
    : `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`

  return `SAL-REP-${stamp}-${report.id.slice(-4).toUpperCase()}`
}

function receiptRef(receipt: BankReceipt) {
  const date = new Date(receipt.receiptDate)
  const stamp = Number.isNaN(date.getTime())
    ? 'UNKNOWN'
    : `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`

  return `RCPT-${stamp}-${receipt.id.slice(-4).toUpperCase()}`
}

export function fromRequest(request: StockRequest): ApprovalRow {
  const units = requestUnitCount(request)
  const approved = approvedUnitCount(request)
  const unitsText = isPartlyApproved(request) && approved !== null
    ? `${approved} of ${units} units`
    : `${units} unit${units === 1 ? '' : 's'}`

  return {
    id: request.id,
    kind: 'REQUEST',
    reference: requestRef(request),
    date: request.createdAt,
    requestedBy: request.requestedBy.name,
    requestedByRole: request.requestedBy.role,
    branch: request.requestedBy.branch?.name ?? '—',
    typeKey: KIND_KEY.REQUEST,
    summary: `${request.items.length} item${request.items.length === 1 ? '' : 's'} (${unitsText})`,
    state:
      request.status === 'PENDING'
        ? 'PENDING'
        : request.status === 'REJECTED'
          ? 'REJECTED'
          : request.status === 'APPROVED' || request.status === 'FULFILLED'
            ? 'APPROVED'
            : 'OTHER',
    decidedAt: request.reviewedAt,
    source: request,
  }
}

export function fromReport(report: CashReport): ApprovalRow {
  return {
    id: report.id,
    kind: 'REPORT',
    reference: reportRef(report),
    date: report.createdAt,
    requestedBy: report.salesperson.name,
    requestedByRole: 'SALES',
    branch: report.salesperson.branch?.name ?? '—',
    typeKey: KIND_KEY.REPORT,
    summary: `${report.sales.length} sale${report.sales.length === 1 ? '' : 's'}`,
    state:
      report.status === 'SUBMITTED'
        ? 'PENDING'
        : report.status === 'REJECTED'
          ? 'REJECTED'
          : report.status === 'APPROVED'
            ? 'APPROVED'
            : 'OTHER',
    decidedAt: report.approvedAt,
    source: report,
  }
}

export function fromReceipt(receipt: BankReceipt): ApprovalRow {
  return {
    id: receipt.id,
    kind: 'RECEIPT',
    reference: receiptRef(receipt),
    date: receipt.createdAt,
    requestedBy: receipt.uploadedBy.name,
    requestedByRole: receipt.uploadedBy.role,
    branch: receipt.uploadedBy.branch?.name ?? '—',
    typeKey: KIND_KEY.RECEIPT,
    summary: `${receipt.bankName} · ${receipt.referenceNumber}`,
    state:
      receipt.status === 'PENDING'
        ? 'PENDING'
        : receipt.status === 'VERIFIED'
          ? 'APPROVED'
          : 'REJECTED',
    decidedAt: null,
    source: receipt,
  }
}

/** Receipts are "verified", not approved; everything else approves. */
export function approvePath(row: ApprovalRow) {
  if (row.kind === 'RECEIPT') return `/api/receipts/${row.id}/verify`
  if (row.kind === 'REPORT') return `/api/cash-reports/${row.id}/approve`
  return `/api/requests/${row.id}/approve`
}

export function rejectPath(row: ApprovalRow) {
  if (row.kind === 'RECEIPT') return `/api/receipts/${row.id}/reject`
  if (row.kind === 'REPORT') return `/api/cash-reports/${row.id}/reject`
  return `/api/requests/${row.id}/reject`
}

/** Each endpoint names the reason differently. */
export function rejectBody(row: ApprovalRow, reason: string) {
  if (row.kind === 'RECEIPT') return { notes: reason }

  return { rejectionReason: reason }
}

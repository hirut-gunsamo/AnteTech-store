export type Role = 'OWNER' | 'SALES'

export type Branch = {
  id: string
  name: string
  isMainStock: boolean
  isActive: boolean
}

export type CurrentUser = {
  id: string
  name: string
  email: string
  phone?: string | null
  role: Role
  isActive: boolean
  branchId: string | null
  branch: Branch | null
}

export type CategoryTotals = Record<
  string,
  { quantity: number; revenue: number }
>

export type PeriodSummary = {
  revenue: number
  cashReceived: number
  transactions: number
  byCategory: CategoryTotals
}

export type TrendBucket = {
  key: string
  label: string
  revenue: number
  cashReceived: number
  transactions: number
  byCategory: CategoryTotals
}

export type BranchPerformance = {
  id: string
  name: string
  revenue: number
  transactions: number
}

/** Per-branch trading. "customers" counts completed purchases, not people. */

export type BranchActivity = {
  id: string
  name: string
  customers: number
  revenue: number
  units: number
  staff: number
}

export type StockBranch = {
  id: string
  name: string
  totalUnits: number
  stockValue: number
  byCategory: CategoryTotals
}

export type CashRow = {
  id: string
  name: string
  branch: string | null
  sold: number
  banked: number
  inHand: number
}

/** One person in the branch and what they are still holding right now. */
export type TeamCashRow = {
  id: string
  name: string
  branch?: string | null
  inHand: number
}

export type Tile = {
  value: number
  changePct: number
}

export type DayBucket = {
  key: string
  label: string
  revenue: number
}

/** One row of the dashboard's activity feed. Facts only; the card words it. */
export type Activity = {
  id: string
  kind: 'SALE' | 'STOCK_IN' | 'TRANSFER' | 'REQUEST' | 'ADJUSTMENT' | 'OTHER'
  at: string
  branch: string | null
  by: string | null
  product?: string
  /** Signed for corrections: negative left the branch, positive arrived. */
  quantity?: number
  /** A sale's total. */
  amount?: number
  /** Units in a sale or a stock request. */
  units?: number
  /** A request's status, or the movement type for OTHER. */
  status?: string
  from?: string | null
  to?: string | null
  /** The person's own words: why stock was corrected or written off. */
  note?: string | null
  /** A correction's balance before and after. */
  before?: number
  after?: number
}

export type Dashboard = {
  today: PeriodSummary
  thisWeek: PeriodSummary
  thisMonth: PeriodSummary
  thisYear: PeriodSummary
  lastMonth: PeriodSummary

  tiles: {
    devices: Tile
    accessories: Tile
    monthSales: Tile
    cashReceived: Tile
  }

  last7Days: {
    buckets: DayBucket[]
    totalSales: number
    itemsSold: number
    transactions: number
  }

  inventoryByCategory: {
    SERIALIZED: number
    QUANTITY: number
    total: number
  }

  recentActivity: Activity[]

  topProducts: {
    id: string
    sku: string
    name: string
    category: string
    price: number
    units: number
    revenue: number
    sharePct: number
  }[]
  topProductsWindow: 'today' | 'month'

  lowStock: {
    id: string
    sku: string
    name: string
    category: string
    branch: string
    quantity: number
    threshold: number
  }[]

  recentSales: {
    id: string
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
    saleDate: string
    total: number
    salesperson: string
    branch: string
    units: number
    summary: string
    category: string
  }[]

  branchActivity: BranchActivity[]


  /** The same shape over four windows, for the branch table's range selector. */
  branchActivityByRange: {
    today: BranchActivity[]
    last7: BranchActivity[]
    month: BranchActivity[]
    year: BranchActivity[]
  }

  monthlyTrend: TrendBucket[]
  branchPerformance: BranchPerformance[]
  stock: {
    totals: { totalUnits: number; stockValue: number }
    branches: StockBranch[]
  }
  cashPosition: {
    salespeople: CashRow[]
    totals: {
      sold: number
      banked: number
      inHand: number
    }
  }
}

/* ---------------------------------------------------------------------------
   Inventory
   --------------------------------------------------------------------------- */

export type InventoryLocation = {
  id: string
  name: string
  isMainStock: boolean
  isActive: boolean
}

export type InventoryProduct = {
  id: string
  sku: string
  name: string
  category: string
  /** Prisma serialises Decimal as a string, so this is not a number. */
  price?: string | number
  status?: string
  /** The Owner's category, where the endpoint includes it. */
  categoryId?: string | null
  productCategory?: { id: string; name: string } | null
  /** The Owner's type; for a phone, its parent is the brand. */
  type?: {
    id: string
    name: string
    parentId: string | null
    parent: { id: string; name: string } | null
  } | null
}

/** One product's quantity at one branch. */
export type InventoryBalance = {
  id: string
  locationId: string
  productId: string
  quantity: number
  updatedAt: string
  product: InventoryProduct
  location: InventoryLocation
}

export type InventorySummary = {
  byCategory: { SERIALIZED: number; QUANTITY: number }
  totalUnits: number
  items: InventoryBalance[]
}

/** One sold serialized unit: a handset or device and its IMEI / serial. */
export type InventoryUnit = {
  id: string
  productId: string
  locationId: string
  status: string
  serial: string
  createdAt: string
  product: Pick<InventoryProduct, 'id' | 'sku' | 'name' | 'category'>
  location: InventoryLocation
}

export type StockMovement = {
  id: string
  productId: string
  quantity: number
  type: string
  notes: string | null
  createdAt: string
  product: Pick<InventoryProduct, 'id' | 'sku' | 'name' | 'category'>
  fromLocation: InventoryLocation | null
  toLocation: InventoryLocation | null
  createdBy: { id: string; name: string; role: string } | null
}

export type CatalogueProduct = InventoryProduct & {
  description: string | null
  price: string
  status: string
}

export type ProductStatus = 'ACTIVE' | 'INACTIVE'

/** A node in the catalogue's type tree: a brand or a model. */
export type TypeNode = {
  id: string
  category: string
  categoryId: string | null
  parentId: string | null
  name: string
  isActive: boolean
  children: TypeNode[]
}

/**
 * A catalogue entry as the Products page reads it: the shared fields, the
 * variant details serialized goods carry, and what every store holds of it.
 */
export type ProductRow = {
  id: string
  sku: string
  name: string
  category: string
  description: string | null
  /** Prisma serialises Decimal as a string. */
  price: string
  status: ProductStatus
  createdAt: string
  phoneDetails: {
    brand: string
    model: string
    storage: string | null
    color: string | null
  } | null
  inventoryBalances: { quantity: number; locationId: string }[]
  /** The deepest type chosen when it was created — a model or a brand. */
  type: { id: string; name: string; parentId: string | null } | null
  categoryId: string | null
  /** The Owner's category; `category` is its kind. */
  productCategory: { id: string; name: string; kind: CategoryKind } | null
}

/* ---------------------------------------------------------------------------
   Branches

   The model is still called StockLocation in the database; "branch" is the
   name it goes by everywhere else.
   --------------------------------------------------------------------------- */

export type BranchRow = {
  id: string
  name: string
  /** The one main store: storage only, where every delivery enters. */
  isMainStock: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
  counts: { users: number; products: number; unitsSold: number }
}

/* ---------------------------------------------------------------------------
   Sales
   --------------------------------------------------------------------------- */

export type SaleStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export type SaleItem = {
  id: string
  quantity: number
  /** Decimal from Prisma, so a string. */
  unitPrice: string
  lineTotal: string
  product: { id: string; sku: string; name: string; category: string }
  inventoryUnits: {
    id: string
    serial: string
  }[]
}

export type Sale = {
  id: string
  status: SaleStatus
  subtotal: string
  totalAmount: string
  cashReceived: string
  paymentMethod: 'CASH' | 'TRANSFER'
  bankName: string | null
  transferReceived: string
  notes: string | null
  rejectionReason?: string | null
  saleDate: string
  submittedAt: string | null
  approvedAt: string | null
  createdAt: string
  salesperson: { id: string; name: string; role: string }
  approvedBy: { id: string; name: string; role: string } | null
  location: { id: string; name: string }
  items: SaleItem[]
}

/* ---------------------------------------------------------------------------
   Stock requests

   A seller asks the Owner to restock their store. The Owner approves and
   names the store the stock ships from, which creates a transfer.
   --------------------------------------------------------------------------- */

export type RequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'FULFILLED'
  | 'CANCELLED'

export type StockRequestKind = 'RESTOCK'

export type StockRequest = {
  id: string
  kind: StockRequestKind
  status: RequestStatus
  notes: string | null
  rejectionReason: string | null
  submittedAt: string | null
  reviewedAt: string | null
  fulfilledAt: string | null
  createdAt: string
  requestedBy: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
  requestedTo: { id: string; name: string; role: string } | null
  approvedBy: { id: string; name: string; role: string } | null
  items: {
    id: string
    /** Units asked for. */
    quantity: number
    /** Units the reviewer agreed to send (0..quantity); null until approved. */
    approvedQuantity: number | null
    product: {
      id: string
      sku: string
      name: string
      category: string
      /** The Owner's category; the request is decided one category at a time. */
      productCategory?: { id: string; name: string } | null
    }
  }[]
  transfer: {
    id: string
    status: string
    /** Named by the Owner on approval; null on transfers made before that. */
    driverName: string | null
    driverPhone: string | null
    vehiclePlate: string | null
    shippedAt: string | null
    receivedAt: string | null
    fromLocation: { id: string; name: string } | null
    toLocation: { id: string; name: string } | null
  } | null
}

/* ---------------------------------------------------------------------------
   Cash reports and bank receipts
   --------------------------------------------------------------------------- */

export type CashReport = {
  id: string
  status: string
  periodStart: string
  periodEnd: string
  expectedCash: string
  actualCash: string
  variance: string
  notes: string | null
  rejectionReason: string | null
  submittedAt: string | null
  approvedAt: string | null
  createdAt: string
  salesperson: {
    id: string
    name: string
    branch: { id: string; name: string } | null
  }
  approvedBy: { id: string; name: string; role: string } | null
  sales: {
    id: string
    saleDate: string
    totalAmount: string
    cashReceived: string
    status: string
  }[]
}

export type BankReceipt = {
  id: string
  bankName: string | null
  referenceNumber: string | null
  /** Null when the bankers credited the account with no slip. */
  fileUrl: string | null
  amount: string
  /** The branch's sales that day, and what was left uncredited after this. */
  daySales: string | null
  yadere: string | null
  location: { id: string; name: string } | null
  receiptDate: string
  status: 'PENDING' | 'VERIFIED' | 'REJECTED'
  notes: string | null
  createdAt: string
  uploadedBy: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
  verifiedBy: { id: string; name: string; role: string } | null
  cashReport: { id: string } | null
}

/* ---------------------------------------------------------------------------
   System users

   OWNER is org-wide and has no store. SALES always belongs to exactly one
   selling store; the main store has no sellers.
   --------------------------------------------------------------------------- */

export type AppUser = {
  id: string
  name: string
  email: string
  /** Null for users created before the column existed. */
  phone: string | null
  role: Role
  isActive: boolean
  branchId: string | null
  createdAt: string
  updatedAt: string
  branch: { id: string; name: string } | null
}

/* ---------------------------------------------------------------------------
   Reports
   --------------------------------------------------------------------------- */

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

export type CategoryFigures = Record<
  string,
  { quantity: number; revenue: number }
>

export type SalesBucket = {
  key: string
  label: string
  revenue: number
  cashReceived: number
  transactions: number
  byCategory: CategoryFigures
}

export type SalesReport = {
  period: ReportPeriod
  from: string | null
  to: string | null
  summary: {
    revenue: number
    cashReceived: number
    transactions: number
    byCategory: CategoryFigures
  }
  buckets: SalesBucket[]
  byBranch: {
    id: string
    name: string
    revenue: number
    cashReceived: number
    transactions: number
    byCategory: CategoryFigures
  }[]
  byItem: {
    id: string
    sku: string
    name: string
    category: string
    categoryName: string | null
    quantity: number
    revenue: number
    branches: Record<string, { quantity: number; revenue: number }>
  }[]
  /** Newest day first; each branch that sold that day, keyed by branch id. */
  dailyByBranch: {
    day: string
    branches: Record<string, { revenue: number; byCategory: CategoryFigures }>
  }[]
}

export type CashPositionReport = {
  from: string | null
  to: string | null
  salespeople: {
    id: string
    name: string
    branch: string
    /** Cash held from before the first day: yadere, brought forward. */
    opening: number
    sold: number
    banked: number
    /** Still held on the last day: keri, which opens the next day. */
    inHand: number
  }[]
  totals: {
    opening: number
    sold: number
    banked: number
    inHand: number
  }
  /** One row per day; null unless both ends of the range were given. */
  days:
    | {
        date: string
        opening: number
        collected: number
        deposited: number
        closing: number
      }[]
    | null
}

export type InventoryReport = {
  branches: {
    id: string
    name: string
    byCategory: CategoryFigures
    totalUnits: number
    stockValue: number
    items: {
      sku: string
      name: string
      category: string
      categoryName: string | null
      quantity: number
      value: number
    }[]
  }[]
}

/* ---------------------------------------------------------------------------
   Organisation settings
   --------------------------------------------------------------------------- */

export type DateFormat = 'medium' | 'short' | 'iso' | 'long'
export type TimeFormat = '24h' | '12h'

export type AppSettings = {
  id: string
  systemName: string
  defaultLanguage: string
  currency: string
  dateFormat: DateFormat
  timeFormat: TimeFormat
  itemsPerPage: number
  notifySales: boolean
  notifyRequests: boolean
  notifyApprovals: boolean
  notifyLowStock: boolean
  notifySystem: boolean
  updatedAt: string
  updatedById: string | null
  updatedBy: { id: string; name: string; role: string } | null
}

export type PermissionAbility = {
  action: string
  owner: boolean
  sales: boolean
  note?: string
}

export type PermissionModule = {
  module: string
  abilities: PermissionAbility[]
}

/* ---------------------------------------------------------------------------
   Notifications
   --------------------------------------------------------------------------- */

export type NotificationKind =
  | 'REQUESTS_TO_DECIDE'
  | 'REPORTS_TO_APPROVE'
  | 'RECEIPTS_TO_VERIFY'
  | 'MY_REQUEST_APPROVED'
  | 'MY_REQUEST_REJECTED'
  | 'DELIVERIES_TO_RECEIVE'
  | 'TRANSFERS_DONE'
  | 'LOW_STOCK'
  | 'EXPENSES_ADDED'

export type Notification = {
  kind: NotificationKind
  count: number
  /** "action" needs a decision from this person; "warn" is a heads-up. */
  tone: 'action' | 'warn'
  href: string
  sample: string[]
  /** When the newest item of this kind arrived, and who sent it. */
  latest?: { at: string; by: string }
}

export type Notifications = {
  notifications: Notification[]
  actionCount: number
  total: number
}

/* ---------------------------------------------------------------------------
   Transfers (stock on the road between branches)
   --------------------------------------------------------------------------- */

export type TransferRow = {
  id: string
  status: 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'
  notes: string | null
  shippedAt: string | null
  receivedAt: string | null
  createdAt: string
  driverName: string | null
  driverPhone: string | null
  vehiclePlate: string | null
  fromLocation: { id: string; name: string; isMainStock: boolean }
  toLocation: { id: string; name: string; isMainStock: boolean }
  deliveredBy: { id: string; name: string } | null
  receivedBy: { id: string; name: string } | null
  request: { id: string; requestedBy: { id: string; name: string } } | null
  items: {
    id: string
    quantity: number
    product: { id: string; sku: string; name: string; category: string }
  }[]
}

/* ---------------------------------------------------------------------------
   Categories the Owner manages
   --------------------------------------------------------------------------- */

/**
 * How a category's goods behave: SERIALIZED goods record an IMEI or serial
 * number for each unit sold, QUANTITY goods are only counted.
 */
export type CategoryKind = 'SERIALIZED' | 'QUANTITY'

export type CategoryRow = {
  id: string
  name: string
  kind: CategoryKind
  isActive: boolean
  _count?: { products: number; types: number }
}

/* ---------------------------------------------------------------------------
   Expenses
   --------------------------------------------------------------------------- */

export type ExpenseReport = {
  total: number
  byBranch: { id: string; name: string; total: number; count: number }[]
  byReason: { reason: string; total: number; count: number }[]
  expenses: {
    id: string
    amount: string
    reason: string
    note: string | null
    expenseDate: string
    createdAt: string
    branch: { id: string; name: string }
    recordedBy: { id: string; name: string }
  }[]
}

/* ---------------------------------------------------------------------------
   Office equipment
   --------------------------------------------------------------------------- */

export type AssetCategory =
  | 'ELECTRONICS'
  | 'FURNITURE'
  | 'STATIONERY'
  | 'OTHER'

export type AssetStatus = 'IN_USE' | 'DAMAGED' | 'RETIRED'

/** One delivery of office equipment to a branch. Never sold, never issued. */
export type OfficeAsset = {
  id: string
  name: string
  category: AssetCategory
  status: AssetStatus
  quantity: number
  serialNumber: string | null
  /** Prisma serialises Decimal as a string; null when the cost is unknown. */
  cost: string | null
  receivedAt: string
  note: string | null
  createdAt: string
  location: { id: string; name: string }
  recordedBy: { id: string; name: string; role: string }
}

/* ---------------------------------------------------------------------------
   Deductions
   --------------------------------------------------------------------------- */

export type Deduction = {
  id: string
  day: string
  total: string
  note: string | null
  createdAt: string
  user: { id: string; name: string; role: string; branch: { id: string; name: string } | null }
  recordedBy: { id: string; name: string }
  lines: {
    id: string
    productId: string | null
    label: string
    quantity: number
    unitPrice: string
    amount: string
  }[]
}

/* ---------------------------------------------------------------------------
   Salaries
   --------------------------------------------------------------------------- */

export type PayrollMonth = {
  month: string
  rows: {
    employee: {
      id: string
      name: string
      role: string
      isActive: boolean
      branch: { id: string; name: string } | null
      monthlySalary: string | null
    }
    salary: number
    /** Commission paid to them under this month, for information only. */
    commission: number
    /** This month's total from the Deductions page, plus carriedIn. */
    deducted: number
    /** What the last salary could not cover, taken off this one. */
    carriedIn: number
    payment: {
      id: string
      bonus: number
      deduction: number
      net: number
      /** Deduction this pay could not cover; taken off the next salary. */
      carriedOver: number
      note: string | null
      paidAt: string
      paidBy: string
    } | null
  }[]
  totals: { salary: number; commission: number; paid: number; unpaid: number }
}

/* ---------------------------------------------------------------------------
   Commission
   --------------------------------------------------------------------------- */

export type CommissionPaymentRow = {
  id: string
  month: string
  total: string
  note: string | null
  paidAt: string
  paidBy: { name: string }
  user: {
    id: string
    name: string
    role: string
    branch: { id: string; name: string } | null
  }
  lines: {
    /** The first day paid for, and the day after the last. */
    periodStart: string
    periodEnd: string
    id: string
    category: 'SERIALIZED' | 'QUANTITY'
    /** The Owner's category; null once that category is deleted. */
    categoryId: string | null
    /** The name it was paid under: "Phones", "Accessories". */
    label: string
    amount: string
    quantity: number
    unitPrice: string
    percent: string | null
  }[]
}

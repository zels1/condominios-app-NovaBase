"""Schemas Pydantic — validação de entrada e forma das respostas da API."""
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field, ConfigDict


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Users ----------
class UserOut(ORMBase):
    id: str
    email: str
    full_name: str
    phone: Optional[str] = None
    role: str
    is_active: bool


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    phone: Optional[str] = None
    role: str = "owner"


# ---------- Condominium ----------
class CondominiumCreate(BaseModel):
    name: str
    nif: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    iban: Optional[str] = None


class CondominiumOut(ORMBase):
    id: str
    name: str
    nif: Optional[str] = None
    address: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    iban: Optional[str] = None
    created_at: datetime


# ---------- Fraction ----------
class FractionCreate(BaseModel):
    identifier: str
    permilagem: float = Field(gt=0)
    fraction_type: str = "habitação"


class FractionOut(ORMBase):
    id: str
    condominium_id: str
    identifier: str
    permilagem: float
    fraction_type: str
    is_active: bool


class FractionOwnerCreate(BaseModel):
    user_id: str
    ownership_share: float = 1.0
    is_primary_contact: bool = True


class FractionOwnerOut(ORMBase):
    id: str
    fraction_id: str
    user_id: str
    ownership_share: float
    is_primary_contact: bool
    user: Optional[UserOut] = None


# ---------- Budget ----------
class BudgetCreate(BaseModel):
    year: int
    total_amount: float = Field(gt=0)
    reserve_fund_percent: float = 10.0
    notes: Optional[str] = None


class BudgetOut(ORMBase):
    id: str
    condominium_id: str
    year: int
    total_amount: float
    reserve_fund_percent: float
    approved_at: Optional[date] = None
    notes: Optional[str] = None


# ---------- Quota ----------
class QuotaGenerateRequest(BaseModel):
    reference_month: date
    due_day: int = 8
    force: bool = False


class QuotaOut(ORMBase):
    id: str
    fraction_id: str
    reference_month: date
    due_date: date
    base_amount: float
    late_fee_amount: float
    amount_paid: float
    status: str
    late_fee_waived: bool


class QuotaWithFraction(QuotaOut):
    fraction_identifier: Optional[str] = None
    owner_name: Optional[str] = None
    total_due: Optional[float] = None


# ---------- Payment ----------
class PaymentCreate(BaseModel):
    amount: float = Field(gt=0)
    paid_at: date = Field(default_factory=date.today)
    method: str = "transferência"
    reference: Optional[str] = None
    notes: Optional[str] = None


class PaymentOut(ORMBase):
    id: str
    quota_id: str
    amount: float
    paid_at: date
    method: str
    reference: Optional[str] = None


# ---------- Late fee config ----------
class LateFeeConfigUpdate(BaseModel):
    enabled: bool = True
    grace_period_days: int = 8
    fee_type: str = "percentage"  # fixed | percentage
    fee_value: float = 10.0
    max_fee_amount: Optional[float] = None


class LateFeeConfigOut(ORMBase):
    id: str
    condominium_id: str
    enabled: bool
    grace_period_days: int
    fee_type: str
    fee_value: float
    max_fee_amount: Optional[float] = None


# ---------- Reminder config ----------
class ReminderConfigCreate(BaseModel):
    days_after_due: int = Field(gt=0)
    enabled: bool = True
    channel: str = "email"
    message_template: str = "A sua quota de {mes} está em atraso. Valor em dívida: {valor}€."


class ReminderConfigOut(ORMBase):
    id: str
    condominium_id: str
    days_after_due: int
    enabled: bool
    channel: str
    message_template: str


class ReminderLogOut(ORMBase):
    id: str
    quota_id: str
    sent_at: datetime
    channel: str
    delivery_status: str


# ---------- Expense / Supplier / Contract ----------
class SupplierCreate(BaseModel):
    name: str
    nif: Optional[str] = None
    category: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None


class SupplierOut(ORMBase):
    id: str
    condominium_id: str
    name: str
    nif: Optional[str] = None
    category: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None


class ContractCreate(BaseModel):
    supplier_id: str
    title: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    renewal_alert_days: int = 30
    annual_value: Optional[float] = None


class ContractOut(ORMBase):
    id: str
    supplier_id: str
    title: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    renewal_alert_days: int
    annual_value: Optional[float] = None


class ExpenseCreate(BaseModel):
    supplier_id: Optional[str] = None
    category: str
    description: Optional[str] = None
    amount: float = Field(gt=0)
    expense_date: date = Field(default_factory=date.today)
    invoice_reference: Optional[str] = None


class ExpenseOut(ORMBase):
    id: str
    condominium_id: str
    supplier_id: Optional[str] = None
    category: str
    description: Optional[str] = None
    amount: float
    expense_date: date
    invoice_reference: Optional[str] = None


# ---------- Occurrence ----------
class OccurrenceCreate(BaseModel):
    fraction_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    photo_url: Optional[str] = None
    priority: str = "normal"


class OccurrenceUpdateCreate(BaseModel):
    status: str
    note: Optional[str] = None


class OccurrenceOut(ORMBase):
    id: str
    condominium_id: str
    fraction_id: Optional[str] = None
    reported_by: str
    title: str
    description: Optional[str] = None
    photo_url: Optional[str] = None
    status: str
    priority: str
    created_at: datetime


# ---------- Assembly / Proxy / Vote ----------
class AssemblyCreate(BaseModel):
    title: str
    assembly_type: str = "ordinária"
    scheduled_at: datetime
    location: Optional[str] = None


class AssemblyOut(ORMBase):
    id: str
    condominium_id: str
    title: str
    assembly_type: str
    scheduled_at: datetime
    location: Optional[str] = None
    status: str


class AgendaItemCreate(BaseModel):
    order: int = 0
    title: str
    description: Optional[str] = None
    requires_vote: bool = True


class AgendaItemOut(ORMBase):
    id: str
    assembly_id: str
    order: int
    title: str
    description: Optional[str] = None
    requires_vote: bool


class ProxyCreate(BaseModel):
    fraction_id: str
    proxy_holder_name: str
    proxy_holder_user_id: Optional[str] = None
    document_url: Optional[str] = None
    is_standing: bool = False


class ProxyOut(ORMBase):
    id: str
    assembly_id: str
    fraction_id: str
    proxy_holder_name: str
    status: str
    is_standing: bool


class VoteCreate(BaseModel):
    fraction_id: str
    choice: str  # favor | against | abstain
    cast_via_proxy: bool = False


class VoteOut(ORMBase):
    id: str
    agenda_item_id: str
    fraction_id: str
    choice: str
    cast_via_proxy: bool
    permilagem_at_vote: float


# ---------- Documents / Communications ----------
class DocumentCreate(BaseModel):
    title: str
    category: Optional[str] = None
    file_url: str
    expires_at: Optional[date] = None


class DocumentOut(ORMBase):
    id: str
    condominium_id: str
    title: str
    category: Optional[str] = None
    file_url: str
    expires_at: Optional[date] = None
    created_at: datetime


class CommunicationCreate(BaseModel):
    title: str
    body: str


class CommunicationOut(ORMBase):
    id: str
    condominium_id: str
    title: str
    body: str
    created_at: datetime


# ---------- Dashboard ----------
class DashboardSummary(BaseModel):
    condominium_id: str
    total_overdue_amount: float
    overdue_quota_count: int
    fractions_in_debt: int
    pending_occurrences: int
    upcoming_assembly: Optional[AssemblyOut] = None
    documents_expiring_soon: List[DocumentOut] = []
    contracts_expiring_soon: List[ContractOut] = []
    this_month_collected: float
    this_month_expected: float

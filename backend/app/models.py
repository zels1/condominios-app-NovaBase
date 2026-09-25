"""
Modelo de dados PostgreSQL para gestão de condomínios.
Usa SQLAlchemy 2.0 style. Todas as tabelas usam UUID como chave primária
para serem seguras de expor em APIs públicas (sem sequência previsível).
"""
import uuid
import enum
from datetime import datetime, date
from sqlalchemy import (
    Column, String, Integer, Numeric, Boolean, Date, DateTime, Text,
    ForeignKey, Enum, UniqueConstraint, CheckConstraint, Index
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


def gen_uuid():
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Utilizadores e autenticação
# ---------------------------------------------------------------------------

class UserRole(str, enum.Enum):
    admin = "admin"          # gestor do condomínio
    owner = "owner"          # condómino
    super_admin = "super_admin"  # gere múltiplas administrações (multi-empresa)


class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=False)
    phone = Column(String)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.owner)
    # Supabase Auth trata da password; guardamos aqui o supabase_user_id de referência
    supabase_user_id = Column(String, unique=True, nullable=True)
    is_active = Column(Boolean, default=True)
    # Ficha completa do condómino
    nif = Column(String, nullable=True)
    correspondence_address = Column(String, nullable=True)
    iban = Column(String, nullable=True)  # IBAN para reembolsos
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner_links = relationship("FractionOwner", back_populates="user")


# ---------------------------------------------------------------------------
# Condomínios, frações, proprietários
# ---------------------------------------------------------------------------

class Condominium(Base):
    __tablename__ = "condominiums"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    nif = Column(String)
    address = Column(String)
    postal_code = Column(String)
    city = Column(String)
    admin_user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    iban = Column(String)  # conta do condomínio, para referência em recibos
    # Ficha completa do condomínio
    district = Column(String, nullable=True)
    municipality = Column(String, nullable=True)
    construction_year = Column(Integer, nullable=True)
    registry_number = Column(String, nullable=True)  # nº de registo predial
    insurance_company = Column(String, nullable=True)  # seguro do edifício
    insurance_policy_number = Column(String, nullable=True)
    insurance_valid_until = Column(Date, nullable=True)
    external_management_name = Column(String, nullable=True)  # administração externa
    external_management_contact = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    fractions = relationship("Fraction", back_populates="condominium", cascade="all, delete-orphan")
    budgets = relationship("Budget", back_populates="condominium", cascade="all, delete-orphan")
    late_fee_config = relationship("LateFeeConfig", back_populates="condominium", uselist=False, cascade="all, delete-orphan")
    reminder_config = relationship("ReminderConfig", back_populates="condominium", cascade="all, delete-orphan")
    expenses = relationship("Expense", back_populates="condominium", cascade="all, delete-orphan")
    assemblies = relationship("Assembly", back_populates="condominium", cascade="all, delete-orphan")


class Fraction(Base):
    """Uma fração = uma unidade (apartamento, loja, garagem...)."""
    __tablename__ = "fractions"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    identifier = Column(String, nullable=False)  # ex: "2º Esq", "Loja A"
    permilagem = Column(Numeric(7, 3), nullable=False)  # soma das frações de um condomínio = 1000.000
    fraction_type = Column(String, default="habitação")  # habitação, comércio, garagem, arrumos
    is_active = Column(Boolean, default=True)
    # Seguro próprio da fração
    insurance_company = Column(String, nullable=True)
    insurance_policy_number = Column(String, nullable=True)
    insurance_valid_until = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    condominium = relationship("Condominium", back_populates="fractions")
    owners = relationship("FractionOwner", back_populates="fraction", cascade="all, delete-orphan")
    quotas = relationship("Quota", back_populates="fraction", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("condominium_id", "identifier", name="uq_fraction_identifier"),
        CheckConstraint("permilagem > 0", name="ck_permilagem_positive"),
    )


class FractionOwner(Base):
    """Liga um User (role=owner) a uma Fraction. Um utilizador pode ter várias frações;
    uma fração pode ter mais de um proprietário (compropriedade), daí ownership_share."""
    __tablename__ = "fraction_owners"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    fraction_id = Column(UUID(as_uuid=False), ForeignKey("fractions.id"), nullable=False)
    # user_id fica nulo enquanto o convite está pendente (a pessoa ainda não criou conta).
    # Quando alguém cria conta com o email de invited_email, o login liga automaticamente.
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    invited_email = Column(String, nullable=True)
    ownership_share = Column(Numeric(5, 4), default=1.0)  # 1.0 = único proprietário
    is_primary_contact = Column(Boolean, default=True)  # quem recebe comunicações/quotas
    start_date = Column(Date, default=date.today)
    end_date = Column(Date, nullable=True)  # preenchido quando vende a fração

    fraction = relationship("Fraction", back_populates="owners")
    user = relationship("User", back_populates="owner_links")


# ---------------------------------------------------------------------------
# Orçamento e Quotas
# ---------------------------------------------------------------------------

class Budget(Base):
    """Orçamento anual aprovado em assembleia, base para o cálculo das quotas mensais."""
    __tablename__ = "budgets"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    year = Column(Integer, nullable=False)
    total_amount = Column(Numeric(12, 2), nullable=False)  # total anual aprovado
    reserve_fund_percent = Column(Numeric(5, 2), default=10.0)  # % obrigatória por lei (fundo comum de reserva)
    approved_at = Column(Date, nullable=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    condominium = relationship("Condominium", back_populates="budgets")

    __table_args__ = (UniqueConstraint("condominium_id", "year", name="uq_budget_year"),)


class QuotaStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    partially_paid = "partially_paid"
    overdue = "overdue"
    waived = "waived"


class Quota(Base):
    """Uma cobrança mensal de uma fração específica."""
    __tablename__ = "quotas"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    fraction_id = Column(UUID(as_uuid=False), ForeignKey("fractions.id"), nullable=False)
    budget_id = Column(UUID(as_uuid=False), ForeignKey("budgets.id"), nullable=True)
    reference_month = Column(Date, nullable=False)  # primeiro dia do mês a que respeita, ex: 2026-10-01
    due_date = Column(Date, nullable=False)
    base_amount = Column(Numeric(10, 2), nullable=False)  # valor original da quota
    late_fee_amount = Column(Numeric(10, 2), default=0)  # juro de mora aplicado, separado do valor base
    amount_paid = Column(Numeric(10, 2), default=0)
    status = Column(Enum(QuotaStatus), default=QuotaStatus.pending)
    late_fee_applied_at = Column(DateTime, nullable=True)
    late_fee_waived = Column(Boolean, default=False)
    generated_at = Column(DateTime, default=datetime.utcnow)

    fraction = relationship("Fraction", back_populates="quotas")
    payments = relationship("Payment", back_populates="quota", cascade="all, delete-orphan")
    reminders_sent = relationship("ReminderLog", back_populates="quota", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("fraction_id", "reference_month", name="uq_quota_fraction_month"),
        Index("ix_quota_status", "status"),
        Index("ix_quota_due_date", "due_date"),
    )

    @property
    def total_due(self):
        return float(self.base_amount) + float(self.late_fee_amount) - float(self.amount_paid)


class Payment(Base):
    """Um pagamento registado, associado a uma quota."""
    __tablename__ = "payments"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    quota_id = Column(UUID(as_uuid=False), ForeignKey("quotas.id"), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    paid_at = Column(Date, nullable=False, default=date.today)
    method = Column(String, default="transferência")  # transferência, multibanco, mbway, numerário
    reference = Column(String)  # nº de referência bancária, se aplicável
    recorded_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    quota = relationship("Quota", back_populates="payments")


# ---------------------------------------------------------------------------
# Juros de mora (configurável por condomínio)
# ---------------------------------------------------------------------------

class LateFeeType(str, enum.Enum):
    fixed = "fixed"          # valor fixo em €
    percentage = "percentage"  # % sobre o valor em falta


class LateFeeConfig(Base):
    __tablename__ = "late_fee_configs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    enabled = Column(Boolean, default=True)
    grace_period_days = Column(Integer, default=8)  # dias de tolerância após vencimento (padrão legal comum: 8 dias)
    fee_type = Column(Enum(LateFeeType), default=LateFeeType.percentage)
    fee_value = Column(Numeric(6, 2), default=10.0)  # 10% ou 10€, consoante fee_type
    max_fee_amount = Column(Numeric(10, 2), nullable=True)  # limite opcional ao juro aplicado
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    condominium = relationship("Condominium", back_populates="late_fee_config")

    __table_args__ = (UniqueConstraint("condominium_id", name="uq_late_fee_condo"),)


# ---------------------------------------------------------------------------
# Lembretes automáticos de pagamento
# ---------------------------------------------------------------------------

class ReminderConfig(Base):
    """Cada linha é um 'degrau' do calendário de lembretes (ex: aos 7, 15, 30 dias)."""
    __tablename__ = "reminder_configs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    days_after_due = Column(Integer, nullable=False)  # ex: 7, 15, 30
    enabled = Column(Boolean, default=True)
    channel = Column(String, default="email")  # email, in_app
    message_template = Column(Text, default="A sua quota de {mes} está em atraso. Valor em dívida: {valor}€.")

    condominium = relationship("Condominium", back_populates="reminder_config")

    __table_args__ = (UniqueConstraint("condominium_id", "days_after_due", name="uq_reminder_step"),)


class ReminderLog(Base):
    """Regista qual lembrete já foi disparado para qual quota, para nunca duplicar."""
    __tablename__ = "reminder_logs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    quota_id = Column(UUID(as_uuid=False), ForeignKey("quotas.id"), nullable=False)
    reminder_config_id = Column(UUID(as_uuid=False), ForeignKey("reminder_configs.id"), nullable=False)
    sent_at = Column(DateTime, default=datetime.utcnow)
    channel = Column(String)
    delivery_status = Column(String, default="queued")  # queued, sent, failed

    quota = relationship("Quota", back_populates="reminders_sent")

    __table_args__ = (UniqueConstraint("quota_id", "reminder_config_id", name="uq_reminder_once"),)


# ---------------------------------------------------------------------------
# Despesas e Fornecedores
# ---------------------------------------------------------------------------

class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    name = Column(String, nullable=False)
    nif = Column(String)
    category = Column(String)  # limpeza, jardinagem, elevador, seguros...
    contact_phone = Column(String)
    contact_email = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    contracts = relationship("Contract", back_populates="supplier", cascade="all, delete-orphan")


class Contract(Base):
    __tablename__ = "contracts"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=False)
    title = Column(String, nullable=False)
    start_date = Column(Date)
    end_date = Column(Date)  # usado para alertas de expiração
    renewal_alert_days = Column(Integer, default=30)
    annual_value = Column(Numeric(10, 2))
    document_url = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="contracts")


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    supplier_id = Column(UUID(as_uuid=False), ForeignKey("suppliers.id"), nullable=True)
    category = Column(String, nullable=False)
    description = Column(String)
    amount = Column(Numeric(10, 2), nullable=False)
    expense_date = Column(Date, nullable=False, default=date.today)
    invoice_reference = Column(String)
    document_url = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    condominium = relationship("Condominium", back_populates="expenses")


# ---------------------------------------------------------------------------
# Manutenção / Ocorrências
# ---------------------------------------------------------------------------

class OccurrenceStatus(str, enum.Enum):
    reported = "reported"
    acknowledged = "acknowledged"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class Occurrence(Base):
    """Reporte de avaria/incidente feito por um condómino ou pelo admin."""
    __tablename__ = "occurrences"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    fraction_id = Column(UUID(as_uuid=False), ForeignKey("fractions.id"), nullable=True)  # nulo = zona comum
    reported_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    photo_url = Column(String)
    status = Column(Enum(OccurrenceStatus), default=OccurrenceStatus.reported)
    priority = Column(String, default="normal")  # baixa, normal, alta, urgente
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    updates = relationship("OccurrenceUpdate", back_populates="occurrence", cascade="all, delete-orphan")


class OccurrenceUpdate(Base):
    """Histórico de estado de uma ocorrência, para o condómino acompanhar o progresso."""
    __tablename__ = "occurrence_updates"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    occurrence_id = Column(UUID(as_uuid=False), ForeignKey("occurrences.id"), nullable=False)
    status = Column(Enum(OccurrenceStatus), nullable=False)
    note = Column(Text)
    updated_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    occurrence = relationship("Occurrence", back_populates="updates")


# ---------------------------------------------------------------------------
# Assembleias, votação e procurações
# ---------------------------------------------------------------------------

class AssemblyStatus(str, enum.Enum):
    scheduled = "scheduled"
    in_progress = "in_progress"
    closed = "closed"


class Assembly(Base):
    __tablename__ = "assemblies"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    title = Column(String, nullable=False)
    assembly_type = Column(String, default="ordinária")  # ordinária, extraordinária
    scheduled_at = Column(DateTime, nullable=False)
    location = Column(String)
    status = Column(Enum(AssemblyStatus), default=AssemblyStatus.scheduled)
    minutes_document_url = Column(String)  # ata, depois de fechada
    created_at = Column(DateTime, default=datetime.utcnow)

    condominium = relationship("Condominium", back_populates="assemblies")
    agenda_items = relationship("AgendaItem", back_populates="assembly", cascade="all, delete-orphan")
    attendances = relationship("Attendance", back_populates="assembly", cascade="all, delete-orphan")
    proxies = relationship("Proxy", back_populates="assembly", cascade="all, delete-orphan")


class AgendaItem(Base):
    __tablename__ = "agenda_items"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    assembly_id = Column(UUID(as_uuid=False), ForeignKey("assemblies.id"), nullable=False)
    order = Column(Integer, default=0)
    title = Column(String, nullable=False)
    description = Column(Text)
    requires_vote = Column(Boolean, default=True)

    assembly = relationship("Assembly", back_populates="agenda_items")
    votes = relationship("Vote", back_populates="agenda_item", cascade="all, delete-orphan")


class ProxyStatus(str, enum.Enum):
    pending_validation = "pending_validation"
    validated = "validated"
    rejected = "rejected"


class Proxy(Base):
    """Procuração: uma fração delega o seu voto a um procurador para uma assembleia específica."""
    __tablename__ = "proxies"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    assembly_id = Column(UUID(as_uuid=False), ForeignKey("assemblies.id"), nullable=False)
    fraction_id = Column(UUID(as_uuid=False), ForeignKey("fractions.id"), nullable=False)
    proxy_holder_name = Column(String, nullable=False)  # pode ser outro condómino ou externo
    proxy_holder_user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    document_url = Column(String)  # procuração assinada digitalizada
    status = Column(Enum(ProxyStatus), default=ProxyStatus.pending_validation)
    is_standing = Column(Boolean, default=False)  # procuração permanente vs só esta assembleia
    created_at = Column(DateTime, default=datetime.utcnow)

    assembly = relationship("Assembly", back_populates="proxies")

    __table_args__ = (UniqueConstraint("assembly_id", "fraction_id", name="uq_proxy_per_fraction_assembly"),)


class Attendance(Base):
    """Presença por fração numa assembleia: presente, representada por procuração, ou ausente."""
    __tablename__ = "attendances"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    assembly_id = Column(UUID(as_uuid=False), ForeignKey("assemblies.id"), nullable=False)
    fraction_id = Column(UUID(as_uuid=False), ForeignKey("fractions.id"), nullable=False)
    attendance_type = Column(String, default="absent")  # present, proxy, absent
    proxy_id = Column(UUID(as_uuid=False), ForeignKey("proxies.id"), nullable=True)
    checked_in_at = Column(DateTime, nullable=True)

    assembly = relationship("Assembly", back_populates="attendances")

    __table_args__ = (UniqueConstraint("assembly_id", "fraction_id", name="uq_attendance_per_fraction"),)


class VoteChoice(str, enum.Enum):
    favor = "favor"
    against = "against"
    abstain = "abstain"


class Vote(Base):
    __tablename__ = "votes"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    agenda_item_id = Column(UUID(as_uuid=False), ForeignKey("agenda_items.id"), nullable=False)
    fraction_id = Column(UUID(as_uuid=False), ForeignKey("fractions.id"), nullable=False)
    choice = Column(Enum(VoteChoice), nullable=False)
    cast_via_proxy = Column(Boolean, default=False)
    cast_by_user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)  # quem carregou no botão
    permilagem_at_vote = Column(Numeric(7, 3), nullable=False)  # peso do voto, fixado no momento
    created_at = Column(DateTime, default=datetime.utcnow)

    agenda_item = relationship("AgendaItem", back_populates="votes")

    __table_args__ = (UniqueConstraint("agenda_item_id", "fraction_id", name="uq_vote_per_fraction_item"),)


# ---------------------------------------------------------------------------
# Documentos e Comunicações
# ---------------------------------------------------------------------------

class Document(Base):
    __tablename__ = "documents"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    title = Column(String, nullable=False)
    category = Column(String)  # ata, seguro, regulamento, contrato...
    file_url = Column(String, nullable=False)
    expires_at = Column(Date, nullable=True)  # para alertas (seguro, certificados)
    uploaded_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Communication(Base):
    """Comunicado geral (não ligado a uma dívida específica) enviado pelo admin."""
    __tablename__ = "communications"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=False)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    sent_by = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Auditoria
# ---------------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    condominium_id = Column(UUID(as_uuid=False), ForeignKey("condominiums.id"), nullable=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    action = Column(String, nullable=False)  # ex: "quota.generated", "payment.recorded"
    entity_type = Column(String)
    entity_id = Column(String)
    details = Column(JSONB)
    created_at = Column(DateTime, default=datetime.utcnow)

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, Trash2, Copy, Printer, ChevronDown, ChevronUp, Bus, Building2,
  UtensilsCrossed, Ticket, Receipt, MapPin, Calendar, Users, Settings,
  ArrowLeft, FileText, Wallet, Eye, GripVertical, Compass, X, Check,
  TrendingUp, ClipboardList
} from "lucide-react";

/* ============================================================
   DATA MODEL
   ============================================================ */

const CATEGORY_DEFS = [
  { key: "transport", label: "Xe / vận chuyển", Icon: Bus },
  { key: "hotel", label: "Khách sạn / lưu trú", Icon: Building2 },
  { key: "meal", label: "Ăn uống", Icon: UtensilsCrossed },
  { key: "ticket", label: "Vé tham quan & HDV", Icon: Ticket },
  { key: "other", label: "Phụ phí khác", Icon: Receipt },
];

const CATEGORY_MAP = Object.fromEntries(CATEGORY_DEFS.map((c) => [c.key, c]));

const PRICING_MODES = [
  { key: "itemized", label: "Cộng từng hạng mục", desc: "Tự cộng tất cả chi phí đã nhập" },
  { key: "perPerson", label: "Theo đầu khách", desc: "Đơn giá nhân số khách" },
  { key: "package", label: "Trọn gói cố định", desc: "Một mức giá cố định cho cả đoàn" },
];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const newExpense = (category) => ({
  id: uid(),
  category,
  name: "",
  unitCost: 0,
  qty: 1,
});

const newDay = (dayNumber) => ({
  id: uid(),
  dayNumber,
  title: "",
  description: "",
  expenses: [],
});

const newTour = () => ({
  id: uid(),
  name: "",
  destination: "",
  startDate: "",
  durationDays: 1,
  pax: 10,
  pricingMode: "itemized",
  perPersonPrice: 0,
  packagePrice: 0,
  marginPercent: 20,
  notes: "",
  company: {
    name: "Công ty Du lịch Việt Hành",
    phone: "0931 08 88 09",
    email: "info@viethanh-tour.vn",
    address: "",
  },
  itinerary: [newDay(1)],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/* ============================================================
   HELPERS
   ============================================================ */

const formatVND = (n) => {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString("vi-VN") + " ₫";
};

const parseNum = (v) => {
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
};

function tourCostBreakdown(tour) {
  const byCategory = Object.fromEntries(CATEGORY_DEFS.map((c) => [c.key, 0]));
  let total = 0;
  for (const day of tour.itinerary) {
    for (const exp of day.expenses) {
      const line = (Number(exp.unitCost) || 0) * (Number(exp.qty) || 0);
      byCategory[exp.category] = (byCategory[exp.category] || 0) + line;
      total += line;
    }
  }
  return { byCategory, total };
}

function tourPricing(tour) {
  const { byCategory, total: costTotal } = tourCostBreakdown(tour);
  const pax = Math.max(1, Number(tour.pax) || 1);
  const margin = Number(tour.marginPercent) || 0;

  let sellTotal = 0;
  let costBasis = costTotal;

  if (tour.pricingMode === "package") {
    sellTotal = Number(tour.packagePrice) || 0;
  } else if (tour.pricingMode === "perPerson") {
    sellTotal = (Number(tour.perPersonPrice) || 0) * pax;
  } else {
    sellTotal = costTotal * (1 + margin / 100);
  }

  const profit = sellTotal - costBasis;
  const profitPercent = costBasis > 0 ? (profit / costBasis) * 100 : 0;
  const sellPerPax = pax > 0 ? sellTotal / pax : 0;
  const costPerPax = pax > 0 ? costBasis / pax : 0;

  return { byCategory, costTotal: costBasis, sellTotal, profit, profitPercent, sellPerPax, costPerPax, pax };
}

/* ============================================================
   STORAGE (localStorage - lưu trên trình duyệt của bạn)
   ============================================================ */

const STORAGE_KEY = "baogiatour_tours";

async function loadTours() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveTours(tours) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tours));
  } catch (e) {
    console.error("Save failed", e);
  }
}

/* ============================================================
   ROOT APP
   ============================================================ */

export default function App() {
  const [tours, setTours] = useState(null); // null = loading
  const [activeTourId, setActiveTourId] = useState(null);
  const [view, setView] = useState("list"); // list | edit | preview
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    loadTours().then((t) => setTours(t));
  }, []);

  const persist = useCallback((next) => {
    setTours(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveTours(next), 400);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const activeTour = useMemo(
    () => (tours || []).find((t) => t.id === activeTourId) || null,
    [tours, activeTourId]
  );

  const updateActiveTour = useCallback(
    (updater) => {
      persist(
        (tours || []).map((t) => {
          if (t.id !== activeTourId) return t;
          const next = typeof updater === "function" ? updater(t) : updater;
          return { ...next, updatedAt: Date.now() };
        })
      );
    },
    [tours, activeTourId, persist]
  );

  const createTour = () => {
    const t = newTour();
    persist([t, ...(tours || [])]);
    setActiveTourId(t.id);
    setView("edit");
  };

  const duplicateTour = (id) => {
    const src = (tours || []).find((t) => t.id === id);
    if (!src) return;
    const copy = { ...src, id: uid(), name: src.name + " (bản sao)", createdAt: Date.now(), updatedAt: Date.now() };
    persist([copy, ...(tours || [])]);
    showToast("Đã sao chép tour");
  };

  const deleteTour = (id) => {
    persist((tours || []).filter((t) => t.id !== id));
    showToast("Đã xoá tour");
  };

  if (tours === null) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.loadingSpinner} />
        <p style={{ color: PALETTE.textMuted, fontSize: 14 }}>Đang tải dữ liệu...</p>
      </div>
    );
  }

  return (
    <div style={styles.appShell}>
      <GlobalStyle />
      {view === "list" && (
        <TourList
          tours={tours}
          onOpen={(id) => {
            setActiveTourId(id);
            setView("edit");
          }}
          onCreate={createTour}
          onDuplicate={duplicateTour}
          onDelete={deleteTour}
        />
      )}
      {view === "edit" && activeTour && (
        <TourEditor
          tour={activeTour}
          onChange={updateActiveTour}
          onBack={() => setView("list")}
          onPreview={() => setView("preview")}
          showToast={showToast}
        />
      )}
      {view === "preview" && activeTour && (
        <QuotePreview tour={activeTour} onBack={() => setView("edit")} />
      )}
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

/* ============================================================
   PALETTE / THEME
   ============================================================ */

const PALETTE = {
  bg: "#FAF8F3",
  surface: "#FFFFFF",
  surfaceAlt: "#F2EFE6",
  ink: "#1C2B28",
  textMuted: "#6B7570",
  textFaint: "#9CA39D",
  border: "#E4DFD2",
  borderStrong: "#D2CBB8",
  primary: "#0F5D52",
  primaryDark: "#0A4339",
  primaryLight: "#E3EFE9",
  accent: "#C1612E",
  accentLight: "#FBEAE0",
  danger: "#B3473A",
  dangerLight: "#FAEBE8",
};

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; }
      .ta-input, .ta-select, .ta-textarea {
        font-family: 'Inter', sans-serif;
        border: 1px solid ${PALETTE.border};
        background: ${PALETTE.surface};
        border-radius: 8px;
        padding: 9px 11px;
        font-size: 14px;
        color: ${PALETTE.ink};
        width: 100%;
        outline: none;
        transition: border-color .15s;
      }
      .ta-input:focus, .ta-select:focus, .ta-textarea:focus {
        border-color: ${PALETTE.primary};
      }
      .ta-input::placeholder, .ta-textarea::placeholder { color: ${PALETTE.textFaint}; }
      .ta-btn {
        font-family: 'Inter', sans-serif;
        font-weight: 500;
        font-size: 14px;
        border-radius: 8px;
        padding: 9px 16px;
        cursor: pointer;
        border: 1px solid transparent;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all .15s;
        white-space: nowrap;
      }
      .ta-btn-primary { background: ${PALETTE.primary}; color: white; }
      .ta-btn-primary:hover { background: ${PALETTE.primaryDark}; }
      .ta-btn-ghost { background: transparent; color: ${PALETTE.ink}; border-color: ${PALETTE.border}; }
      .ta-btn-ghost:hover { background: ${PALETTE.surfaceAlt}; }
      .ta-btn-danger { background: transparent; color: ${PALETTE.danger}; border-color: transparent; }
      .ta-btn-danger:hover { background: ${PALETTE.dangerLight}; }
      .ta-btn:active { transform: scale(0.98); }
      .ta-card {
        background: ${PALETTE.surface};
        border: 1px solid ${PALETTE.border};
        border-radius: 14px;
      }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: ${PALETTE.borderStrong}; border-radius: 4px; }
      @media print {
        body * { visibility: hidden; }
        #print-area, #print-area * { visibility: visible; }
        #print-area { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `}</style>
  );
}

const styles = {
  appShell: {
    minHeight: "100vh",
    background: PALETTE.bg,
    fontFamily: "'Inter', sans-serif",
    color: PALETTE.ink,
  },
  loadingScreen: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    background: PALETTE.bg,
  },
  loadingSpinner: {
    width: 28,
    height: 28,
    border: `3px solid ${PALETTE.border}`,
    borderTopColor: PALETTE.primary,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  toast: {
    position: "fixed",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    background: PALETTE.ink,
    color: "white",
    padding: "10px 18px",
    borderRadius: 10,
    fontSize: 13.5,
    fontWeight: 500,
    zIndex: 999,
  },
};

/* ============================================================
   PLACEHOLDER (sections continue below)
   ============================================================ */

/* ============================================================
   TOUR LIST (HOME)
   ============================================================ */

function TourList({ tours, onOpen, onCreate, onDuplicate, onDelete }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const sorted = [...tours].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: PALETTE.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Compass size={22} color="white" strokeWidth={2} />
          </div>
          <div>
            <h1
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 24,
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Báo giá tour
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: PALETTE.textMuted }}>
              {tours.length} tour đã lưu
            </p>
          </div>
        </div>
        <button className="ta-btn ta-btn-primary" onClick={onCreate}>
          <Plus size={16} /> Tạo tour mới
        </button>
      </header>

      {sorted.length === 0 ? (
        <EmptyState onCreate={onCreate} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {sorted.map((tour) => {
            const { sellTotal, costTotal, profit } = tourPricing(tour);
            return (
              <div
                key={tour.id}
                className="ta-card"
                style={{ padding: "18px 20px", cursor: "pointer", position: "relative" }}
                onClick={() => onOpen(tour.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <h3
                      style={{
                        margin: "0 0 4px",
                        fontSize: 16,
                        fontWeight: 600,
                        fontFamily: "'Fraunces', serif",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tour.name || "Tour chưa đặt tên"}
                    </h3>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, color: PALETTE.textMuted, fontSize: 12.5 }}>
                      <MapPin size={13} />
                      <span>{tour.destination || "Chưa có điểm đến"}</span>
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "3px 9px",
                      borderRadius: 20,
                      background: PALETTE.primaryLight,
                      color: PALETTE.primaryDark,
                      flexShrink: 0,
                    }}
                  >
                    {tour.durationDays}N{tour.durationDays > 1 ? `${tour.durationDays - 1}Đ` : ""}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 14, margin: "14px 0 12px", fontSize: 12.5, color: PALETTE.textMuted }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Users size={13} /> {tour.pax} khách
                  </div>
                  {tour.startDate && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Calendar size={13} /> {tour.startDate}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    borderTop: `1px solid ${PALETTE.border}`,
                    paddingTop: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-end",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: PALETTE.textFaint }}>Giá bán</div>
                    <div style={{ fontSize: 17, fontWeight: 600, color: PALETTE.primaryDark }}>
                      {formatVND(sellTotal)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: PALETTE.textFaint }}>Lợi nhuận</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: profit >= 0 ? PALETTE.primary : PALETTE.danger }}>
                      {formatVND(profit)}
                    </div>
                  </div>
                </div>

                <div
                  className="no-print"
                  style={{
                    display: "flex",
                    gap: 4,
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: `1px solid ${PALETTE.border}`,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="ta-btn ta-btn-ghost"
                    style={{ flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12.5 }}
                    onClick={() => onDuplicate(tour.id)}
                  >
                    <Copy size={13} /> Sao chép
                  </button>
                  {confirmDeleteId === tour.id ? (
                    <button
                      className="ta-btn"
                      style={{ flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12.5, background: PALETTE.danger, color: "white" }}
                      onClick={() => {
                        onDelete(tour.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      <Check size={13} /> Xác nhận xoá
                    </button>
                  ) : (
                    <button
                      className="ta-btn ta-btn-danger"
                      style={{ flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12.5 }}
                      onClick={() => setConfirmDeleteId(tour.id)}
                    >
                      <Trash2 size={13} /> Xoá
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "80px 20px",
        border: `1px dashed ${PALETTE.borderStrong}`,
        borderRadius: 16,
        background: PALETTE.surface,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: PALETTE.primaryLight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px",
        }}
      >
        <Compass size={28} color={PALETTE.primary} />
      </div>
      <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, margin: "0 0 6px" }}>Chưa có tour nào</h3>
      <p style={{ color: PALETTE.textMuted, fontSize: 14, margin: "0 0 20px" }}>
        Tạo báo giá tour đầu tiên của bạn để bắt đầu
      </p>
      <button className="ta-btn ta-btn-primary" onClick={onCreate} style={{ margin: "0 auto" }}>
        <Plus size={16} /> Tạo tour mới
      </button>
    </div>
  );
}

/* ============================================================
   TOUR EDITOR
   ============================================================ */

function TourEditor({ tour, onChange, onBack, onPreview, showToast }) {
  const pricing = tourPricing(tour);

  const setField = (key, value) => onChange((t) => ({ ...t, [key]: value }));
  const setCompanyField = (key, value) =>
    onChange((t) => ({ ...t, company: { ...t.company, [key]: value } }));

  const setDuration = (days) => {
    days = Math.max(1, Math.min(60, days));
    onChange((t) => {
      const itinerary = [...t.itinerary];
      while (itinerary.length < days) itinerary.push(newDay(itinerary.length + 1));
      while (itinerary.length > days) itinerary.pop();
      return { ...t, durationDays: days, itinerary };
    });
  };

  const updateDay = (dayId, updater) => {
    onChange((t) => ({
      ...t,
      itinerary: t.itinerary.map((d) => (d.id === dayId ? updater(d) : d)),
    }));
  };

  const addExpense = (dayId, category) => {
    updateDay(dayId, (d) => ({ ...d, expenses: [...d.expenses, newExpense(category)] }));
  };

  const updateExpense = (dayId, expId, patch) => {
    updateDay(dayId, (d) => ({
      ...d,
      expenses: d.expenses.map((e) => (e.id === expId ? { ...e, ...patch } : e)),
    }));
  };

  const removeExpense = (dayId, expId) => {
    updateDay(dayId, (d) => ({ ...d, expenses: d.expenses.filter((e) => e.id !== expId) }));
  };

  return (
    <div>
      <EditorTopBar tour={tour} onBack={onBack} onPreview={onPreview} />

      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "24px 24px 100px",
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TourBasicsCard tour={tour} setField={setField} setDuration={setDuration} />
          <PricingModeCard tour={tour} setField={setField} pricing={pricing} />

          <div>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "8px 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <ClipboardList size={18} /> Lịch trình & chi phí
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {tour.itinerary.map((day) => (
                <DayCard
                  key={day.id}
                  day={day}
                  onUpdate={(patch) => updateDay(day.id, (d) => ({ ...d, ...patch }))}
                  onAddExpense={(cat) => addExpense(day.id, cat)}
                  onUpdateExpense={(expId, patch) => updateExpense(day.id, expId, patch)}
                  onRemoveExpense={(expId) => removeExpense(day.id, expId)}
                />
              ))}
            </div>
          </div>

          <CompanyInfoCard tour={tour} setCompanyField={setCompanyField} />

          <div className="ta-card" style={{ padding: 18 }}>
            <label style={labelStyle}>Ghi chú nội bộ</label>
            <textarea
              className="ta-textarea"
              rows={3}
              placeholder="Ghi chú riêng, không hiển thị cho khách..."
              value={tour.notes}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </div>
        </div>

        <div style={{ position: "sticky", top: 88, alignSelf: "start" }}>
          <SummaryPanel pricing={pricing} tour={tour} onPreview={onPreview} />
        </div>
      </div>
    </div>
  );
}

function EditorTopBar({ tour, onBack, onPreview }) {
  return (
    <div
      className="no-print"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "rgba(250,248,243,0.92)",
        backdropFilter: "blur(6px)",
        borderBottom: `1px solid ${PALETTE.border}`,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <button className="ta-btn ta-btn-ghost" onClick={onBack}>
          <ArrowLeft size={16} /> Danh sách tour
        </button>
        <div
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 15,
            fontWeight: 600,
            color: PALETTE.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            textAlign: "center",
          }}
        >
          {tour.name || "Tour chưa đặt tên"}
        </div>
        <button className="ta-btn ta-btn-primary" onClick={onPreview}>
          <Eye size={16} /> Xem báo giá
        </button>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block",
  fontSize: 12.5,
  fontWeight: 500,
  color: PALETTE.textMuted,
  marginBottom: 6,
};

function Field({ label, children, span }) {
  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function TourBasicsCard({ tour, setField, setDuration }) {
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "0 0 14px" }}>Thông tin tour</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Tên tour" span={2}>
          <input
            className="ta-input"
            placeholder="VD: Đà Lạt mộng mơ 3N2Đ"
            value={tour.name}
            onChange={(e) => setField("name", e.target.value)}
          />
        </Field>
        <Field label="Điểm đến">
          <input
            className="ta-input"
            placeholder="VD: Đà Lạt"
            value={tour.destination}
            onChange={(e) => setField("destination", e.target.value)}
          />
        </Field>
        <Field label="Ngày khởi hành">
          <input
            className="ta-input"
            type="date"
            value={tour.startDate}
            onChange={(e) => setField("startDate", e.target.value)}
          />
        </Field>
        <Field label="Số ngày">
          <input
            className="ta-input"
            type="number"
            min={1}
            max={60}
            value={tour.durationDays}
            onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
          />
        </Field>
        <Field label="Số lượng khách">
          <input
            className="ta-input"
            type="number"
            min={1}
            value={tour.pax}
            onChange={(e) => setField("pax", Math.max(1, parseInt(e.target.value) || 1))}
          />
        </Field>
      </div>
    </div>
  );
}

function PricingModeCard({ tour, setField, pricing }) {
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "0 0 14px" }}>Cách tính giá</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
        {PRICING_MODES.map((m) => {
          const active = tour.pricingMode === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setField("pricingMode", m.key)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1.5px solid ${active ? PALETTE.primary : PALETTE.border}`,
                background: active ? PALETTE.primaryLight : PALETTE.surface,
                cursor: "pointer",
                fontFamily: "'Inter', sans-serif",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? PALETTE.primaryDark : PALETTE.ink, marginBottom: 2 }}>
                {m.label}
              </div>
              <div style={{ fontSize: 11.5, color: PALETTE.textMuted, lineHeight: 1.4 }}>{m.desc}</div>
            </button>
          );
        })}
      </div>

      {tour.pricingMode === "itemized" && (
        <Field label={`Tỷ lệ lợi nhuận trên giá vốn (${tour.marginPercent}%)`}>
          <input
            type="range"
            min={0}
            max={100}
            value={tour.marginPercent}
            onChange={(e) => setField("marginPercent", parseInt(e.target.value))}
            style={{ width: "100%" }}
          />
        </Field>
      )}
      {tour.pricingMode === "perPerson" && (
        <Field label="Đơn giá / khách (VNĐ)">
          <CurrencyInput value={tour.perPersonPrice} onChange={(v) => setField("perPersonPrice", v)} />
        </Field>
      )}
      {tour.pricingMode === "package" && (
        <Field label="Giá trọn gói cả đoàn (VNĐ)">
          <CurrencyInput value={tour.packagePrice} onChange={(v) => setField("packagePrice", v)} />
        </Field>
      )}
    </div>
  );
}

function CurrencyInput({ value, onChange }) {
  const [local, setLocal] = useState(value ? value.toLocaleString("vi-VN") : "");
  useEffect(() => {
    setLocal(value ? Number(value).toLocaleString("vi-VN") : "");
  }, [value]);
  return (
    <input
      className="ta-input"
      inputMode="numeric"
      placeholder="0"
      value={local}
      onChange={(e) => {
        const n = parseNum(e.target.value);
        setLocal(n ? n.toLocaleString("vi-VN") : e.target.value);
        onChange(n);
      }}
      onBlur={() => setLocal(value ? Number(value).toLocaleString("vi-VN") : "")}
    />
  );
}

function CompanyInfoCard({ tour, setCompanyField }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: 0 }}>Thông tin công ty (in trên báo giá)</h2>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <Field label="Tên công ty" span={2}>
            <input className="ta-input" value={tour.company.name} onChange={(e) => setCompanyField("name", e.target.value)} />
          </Field>
          <Field label="Số điện thoại">
            <input className="ta-input" value={tour.company.phone} onChange={(e) => setCompanyField("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="ta-input" value={tour.company.email} onChange={(e) => setCompanyField("email", e.target.value)} />
          </Field>
          <Field label="Địa chỉ" span={2}>
            <input className="ta-input" value={tour.company.address} onChange={(e) => setCompanyField("address", e.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );
}

/* ---------- Day card with expenses ---------- */

function DayCard({ day, onUpdate, onAddExpense, onUpdateExpense, onRemoveExpense }) {
  const [collapsed, setCollapsed] = useState(false);
  const dayTotal = day.expenses.reduce((s, e) => s + (Number(e.unitCost) || 0) * (Number(e.qty) || 0), 0);

  return (
    <div className="ta-card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 18px",
          cursor: "pointer",
          background: PALETTE.surfaceAlt,
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: PALETTE.primary,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {day.dayNumber}
        </div>
        <input
          className="ta-input"
          placeholder={`Tiêu đề ngày ${day.dayNumber} (VD: Khởi hành - Tham quan trung tâm)`}
          value={day.title}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate({ title: e.target.value })}
          style={{ background: "white", flex: 1 }}
        />
        <div style={{ fontSize: 13, fontWeight: 600, color: PALETTE.primaryDark, whiteSpace: "nowrap" }}>
          {formatVND(dayTotal)}
        </div>
        {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </div>

      {!collapsed && (
        <div style={{ padding: 18 }}>
          <Field label="Mô tả lịch trình (hiển thị cho khách)">
            <textarea
              className="ta-textarea"
              rows={2}
              placeholder="VD: 07:00 đón khách tại điểm hẹn, di chuyển đến... Ăn trưa tại... Tham quan..."
              value={day.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
            />
          </Field>

          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {CATEGORY_DEFS.map((cat) => {
              const items = day.expenses.filter((e) => e.category === cat.key);
              return (
                <div key={cat.key}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: PALETTE.textMuted }}>
                      <cat.Icon size={14} /> {cat.label}
                    </div>
                    <button
                      className="ta-btn ta-btn-ghost"
                      style={{ padding: "3px 9px", fontSize: 12 }}
                      onClick={() => onAddExpense(cat.key)}
                    >
                      <Plus size={12} /> Thêm
                    </button>
                  </div>
                  {items.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((exp) => (
                        <ExpenseRow
                          key={exp.id}
                          expense={exp}
                          onUpdate={(patch) => onUpdateExpense(exp.id, patch)}
                          onRemove={() => onRemoveExpense(exp.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ExpenseRow({ expense, onUpdate, onRemove }) {
  const line = (Number(expense.unitCost) || 0) * (Number(expense.qty) || 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 110px 30px", gap: 6, alignItems: "center" }}>
      <input
        className="ta-input"
        placeholder="Tên khoản chi (VD: Xe 16 chỗ)"
        value={expense.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        style={{ padding: "7px 10px", fontSize: 13 }}
      />
      <input
        className="ta-input"
        placeholder="Đơn giá"
        inputMode="numeric"
        value={expense.unitCost ? Number(expense.unitCost).toLocaleString("vi-VN") : ""}
        onChange={(e) => onUpdate({ unitCost: parseNum(e.target.value) })}
        style={{ padding: "7px 10px", fontSize: 13 }}
      />
      <input
        className="ta-input"
        placeholder="SL"
        type="number"
        min={0}
        value={expense.qty}
        onChange={(e) => onUpdate({ qty: parseNum(e.target.value) })}
        style={{ padding: "7px 10px", fontSize: 13 }}
      />
      <div style={{ fontSize: 13, fontWeight: 500, textAlign: "right", color: PALETTE.textMuted, paddingRight: 4 }}>
        {formatVND(line)}
      </div>
      <button
        onClick={onRemove}
        aria-label="Xoá khoản chi"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: PALETTE.textFaint,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/* ---------- Right sticky summary panel ---------- */

function SummaryPanel({ pricing, tour, onPreview }) {
  return (
    <div className="ta-card" style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 17, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 7 }}>
        <Wallet size={17} /> Tổng kết tài chính
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {CATEGORY_DEFS.map((cat) => {
          const amount = pricing.byCategory[cat.key] || 0;
          if (amount === 0) return null;
          return (
            <div key={cat.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: PALETTE.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
                <cat.Icon size={13} /> {cat.label}
              </span>
              <span style={{ fontWeight: 500 }}>{formatVND(amount)}</span>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${PALETTE.border}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <Row label="Tổng giá vốn" value={formatVND(pricing.costTotal)} muted />
        <Row label="Giá vốn / khách" value={formatVND(pricing.costPerPax)} muted small />
      </div>

      <div
        style={{
          marginTop: 14,
          padding: "14px 16px",
          background: PALETTE.primaryLight,
          borderRadius: 10,
        }}
      >
        <Row label="Giá bán (cả đoàn)" value={formatVND(pricing.sellTotal)} big />
        <Row label="Giá bán / khách" value={formatVND(pricing.sellPerPax)} small />
      </div>

      <div
        style={{
          marginTop: 10,
          padding: "12px 16px",
          background: pricing.profit >= 0 ? PALETTE.accentLight : PALETTE.dangerLight,
          borderRadius: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: pricing.profit >= 0 ? PALETTE.accent : PALETTE.danger, display: "flex", alignItems: "center", gap: 6 }}>
          <TrendingUp size={14} /> Lợi nhuận dự kiến
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: pricing.profit >= 0 ? PALETTE.accent : PALETTE.danger }}>
          {formatVND(pricing.profit)} ({pricing.profitPercent.toFixed(1)}%)
        </span>
      </div>

      <button className="ta-btn ta-btn-primary" onClick={onPreview} style={{ width: "100%", justifyContent: "center", marginTop: 16, padding: "11px" }}>
        <Eye size={16} /> Xem & in báo giá
      </button>
    </div>
  );
}

function Row({ label, value, muted, big, small }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: small ? 12 : 13, color: muted ? PALETTE.textMuted : PALETTE.ink }}>{label}</span>
      <span
        style={{
          fontSize: big ? 22 : small ? 12.5 : 14,
          fontWeight: big ? 700 : 600,
          color: big ? PALETTE.primaryDark : muted ? PALETTE.textMuted : PALETTE.ink,
          fontFamily: big ? "'Fraunces', serif" : "'Inter', sans-serif",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ============================================================
   QUOTE PREVIEW / PRINT
   ============================================================ */

function QuotePreview({ tour, onBack }) {
  const [mode, setMode] = useState("client"); // client | internal
  const pricing = tourPricing(tour);

  const handlePrint = () => window.print();

  return (
    <div>
      <div
        className="no-print"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(250,248,243,0.95)",
          backdropFilter: "blur(6px)",
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <button className="ta-btn ta-btn-ghost" onClick={onBack}>
            <ArrowLeft size={16} /> Quay lại chỉnh sửa
          </button>

          <div style={{ display: "flex", gap: 6, background: PALETTE.surfaceAlt, padding: 4, borderRadius: 10 }}>
            <button
              onClick={() => setMode("client")}
              className="ta-btn"
              style={{
                background: mode === "client" ? PALETTE.surface : "transparent",
                border: "none",
                boxShadow: mode === "client" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                color: mode === "client" ? PALETTE.ink : PALETTE.textMuted,
              }}
            >
              <FileText size={15} /> Bản gửi khách
            </button>
            <button
              onClick={() => setMode("internal")}
              className="ta-btn"
              style={{
                background: mode === "internal" ? PALETTE.surface : "transparent",
                border: "none",
                boxShadow: mode === "internal" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                color: mode === "internal" ? PALETTE.ink : PALETTE.textMuted,
              }}
            >
              <Wallet size={15} /> Bảng nội bộ
            </button>
          </div>

          <button className="ta-btn ta-btn-primary" onClick={handlePrint}>
            <Printer size={16} /> In / Xuất PDF
          </button>
        </div>
      </div>

      <div style={{ padding: "32px 24px 80px" }}>
        <div id="print-area" style={{ maxWidth: 794, margin: "0 auto" }}>
          {mode === "client" ? (
            <ClientQuoteDoc tour={tour} pricing={pricing} />
          ) : (
            <InternalQuoteDoc tour={tour} pricing={pricing} />
          )}
        </div>
      </div>
    </div>
  );
}

function DocShell({ children }) {
  return (
    <div
      className="ta-card"
      style={{
        background: "white",
        padding: "48px 52px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {children}
    </div>
  );
}

function ClientQuoteDoc({ tour, pricing }) {
  return (
    <DocShell>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, paddingBottom: 24, borderBottom: `2px solid ${PALETTE.primary}` }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, color: PALETTE.primaryDark, fontFamily: "'Fraunces', serif" }}>
            {tour.company.name}
          </div>
          <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 4, lineHeight: 1.6 }}>
            {tour.company.address && <div>{tour.company.address}</div>}
            <div>
              {tour.company.phone}
              {tour.company.email ? ` · ${tour.company.email}` : ""}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: PALETTE.textFaint, textTransform: "uppercase" }}>Báo giá tour</div>
          {tour.startDate && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 4 }}>Khởi hành: {tour.startDate}</div>}
        </div>
      </div>

      {/* Tour title */}
      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 600, margin: "0 0 8px", color: PALETTE.ink }}>
        {tour.name || "Chương trình tour"}
      </h1>
      <div style={{ display: "flex", gap: 18, fontSize: 13, color: PALETTE.textMuted, marginBottom: 30 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <MapPin size={14} /> {tour.destination || "—"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Calendar size={14} /> {tour.durationDays} ngày {tour.durationDays > 1 ? `${tour.durationDays - 1} đêm` : ""}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Users size={14} /> {tour.pax} khách
        </span>
      </div>

      {/* Itinerary */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {tour.itinerary.map((day, i) => (
          <div key={day.id} style={{ display: "flex", gap: 16, position: "relative", paddingBottom: i === tour.itinerary.length - 1 ? 0 : 22 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: PALETTE.primary,
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: "'Fraunces', serif",
                  zIndex: 1,
                }}
              >
                {day.dayNumber}
              </div>
              {i !== tour.itinerary.length - 1 && (
                <div style={{ width: 2, flex: 1, background: PALETTE.border, marginTop: 2 }} />
              )}
            </div>
            <div style={{ flex: 1, paddingTop: 4 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: PALETTE.ink, marginBottom: 4 }}>
                Ngày {day.dayNumber}
                {day.title ? `: ${day.title}` : ""}
              </div>
              {day.description && (
                <div style={{ fontSize: 13, color: PALETTE.textMuted, lineHeight: 1.7, whiteSpace: "pre-line" }}>
                  {day.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Price box */}
      <div
        style={{
          marginTop: 32,
          padding: "20px 24px",
          background: PALETTE.primaryLight,
          borderRadius: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 12.5, color: PALETTE.primaryDark, fontWeight: 600 }}>Giá tour trọn gói</div>
          <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 2 }}>
            {formatVND(pricing.sellPerPax)} / khách × {pricing.pax} khách
          </div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: PALETTE.primaryDark, fontFamily: "'Fraunces', serif" }}>
          {formatVND(pricing.sellTotal)}
        </div>
      </div>

      {tour.notes === "" ? null : null}

      <div style={{ marginTop: 24, fontSize: 11.5, color: PALETTE.textFaint, lineHeight: 1.6 }}>
        Báo giá có giá trị tham khảo, có thể thay đổi tuỳ thời điểm và số lượng khách thực tế. Vui lòng liên hệ để được tư vấn và xác nhận chi tiết.
      </div>
    </DocShell>
  );
}

function InternalQuoteDoc({ tour, pricing }) {
  return (
    <DocShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${PALETTE.border}` }}>
        <div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, margin: 0 }}>
            {tour.name || "Tour chưa đặt tên"} — Bảng tính nội bộ
          </h1>
          <div style={{ fontSize: 12.5, color: PALETTE.textMuted, marginTop: 4 }}>
            {tour.destination} · {tour.durationDays} ngày · {tour.pax} khách
            {tour.startDate ? ` · Khởi hành ${tour.startDate}` : ""}
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 6,
            background: PALETTE.dangerLight,
            color: PALETTE.danger,
          }}
        >
          NỘI BỘ — KHÔNG GỬI KHÁCH
        </span>
      </div>

      {/* Cost table by day */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: `1.5px solid ${PALETTE.ink}` }}>
            <th style={thStyle}>Ngày</th>
            <th style={thStyle}>Hạng mục</th>
            <th style={thStyle}>Khoản chi</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Đơn giá</th>
            <th style={{ ...thStyle, textAlign: "right" }}>SL</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {tour.itinerary.flatMap((day) =>
            day.expenses.length === 0
              ? []
              : day.expenses.map((exp, idx) => (
                  <tr key={exp.id} style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
                    <td style={tdStyle}>{idx === 0 ? `Ngày ${day.dayNumber}` : ""}</td>
                    <td style={tdStyle}>{CATEGORY_MAP[exp.category]?.label}</td>
                    <td style={tdStyle}>{exp.name || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{formatVND(exp.unitCost)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{exp.qty}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                      {formatVND((Number(exp.unitCost) || 0) * (Number(exp.qty) || 0))}
                    </td>
                  </tr>
                ))
          )}
        </tbody>
      </table>

      {/* Category summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 24 }}>
        {CATEGORY_DEFS.map((cat) => (
          <div key={cat.key} style={{ background: PALETTE.surfaceAlt, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginBottom: 3 }}>{cat.label}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{formatVND(pricing.byCategory[cat.key] || 0)}</div>
          </div>
        ))}
      </div>

      {/* Financial summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          padding: "18px 20px",
          background: PALETTE.ink,
          borderRadius: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Tổng giá vốn</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "white" }}>{formatVND(pricing.costTotal)}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{formatVND(pricing.costPerPax)} / khách</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Giá bán</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "white" }}>{formatVND(pricing.sellTotal)}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{formatVND(pricing.sellPerPax)} / khách</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Lợi nhuận</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: pricing.profit >= 0 ? "#7FD9B8" : "#F0997B" }}>
            {formatVND(pricing.profit)}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{pricing.profitPercent.toFixed(1)}% trên giá vốn</div>
        </div>
      </div>

      {tour.notes && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: PALETTE.textMuted, marginBottom: 4 }}>Ghi chú nội bộ</div>
          <div style={{ fontSize: 12.5, color: PALETTE.ink, whiteSpace: "pre-line", lineHeight: 1.6 }}>{tour.notes}</div>
        </div>
      )}
    </DocShell>
  );
}

const thStyle = { textAlign: "left", padding: "8px 6px", fontWeight: 600, color: PALETTE.textMuted, fontSize: 11.5 };
const tdStyle = { padding: "8px 6px", color: PALETTE.ink };

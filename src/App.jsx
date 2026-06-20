import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, Trash2, Copy, Printer, ChevronDown, ChevronUp, MapPin, Calendar,
  Users, ArrowLeft, FileText, Wallet, Eye, Compass, X, Check, TrendingUp,
  ClipboardList, Image as ImageIcon, GripVertical, Folder, Percent, Camera,
  DollarSign,
} from "lucide-react";

/* ============================================================
   DATA MODEL
   ============================================================ */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// A line item inside a cost category, e.g. "Xe 16 chỗ" inside "Vận chuyển"
const newCostItem = () => ({
  id: uid(),
  name: "",
  unitCost: 0,
  qty: 1,
  unit: "Cái", // ĐVT: free text, e.g. Ngày, Đêm, Vé, Bữa, Cái, Xe...
  vatPercent: 0,
  splitByPax: false, // if true: total = (unitCost * qty) / pax  (like Xe, HDV in screenshot)
});

// A cost category, e.g. "Vận chuyển", "Ăn uống"... user can add/remove freely
const newCostCategory = (name = "") => ({
  id: uid(),
  name,
  items: [newCostItem()],
});

const DEFAULT_CATEGORIES = () => [
  { ...newCostCategory("Vận chuyển"), items: [{ ...newCostItem(), name: "Xe ...", unit: "Xe", splitByPax: true }] },
  { ...newCostCategory("Ăn uống"), items: [{ ...newCostItem(), name: "Bữa chính", unit: "Bữa" }] },
  { ...newCostCategory("Lưu trú"), items: [{ ...newCostItem(), name: "Khách sạn", unit: "Đêm" }] },
  { ...newCostCategory("Tham quan"), items: [{ ...newCostItem(), name: "Vé tham quan", unit: "Vé" }] },
  { ...newCostCategory("HDV"), items: [{ ...newCostItem(), name: "Công tác phí", unit: "Ngày", splitByPax: true }] },
];

// A point of interest / stop within a day, with its own photo
const newStop = () => ({
  id: uid(),
  name: "",
  description: "",
  imageUrl: "",
});

const newDay = (dayNumber) => ({
  id: uid(),
  dayNumber,
  title: "",
  summary: "", // short narrative for the day, optional
  stops: [],
});

const newTour = () => ({
  id: uid(),
  name: "",
  destination: "",
  startDate: "",
  durationDays: 1,
  pax: 10,
  coverImageUrl: "",
  costCategories: DEFAULT_CATEGORIES(),
  profitMode: "percent", // "percent" | "fixed"
  profitPercent: 10,
  profitFixed: 0,
  roundTo: 10000, // làm tròn giá bán đến bội số này (VNĐ)
  displayCurrency: "VND", // "VND" | "USD" — chỉ ảnh hưởng cách hiển thị, dữ liệu gốc luôn lưu bằng VND
  exchangeRate: 25400, // 1 USD = bao nhiêu VNĐ, dùng để quy đổi khi hiển thị USD
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

// Format an amount (always stored internally in VND) into the chosen display currency
const formatMoney = (amountVnd, currency, exchangeRate) => {
  const n = Number(amountVnd) || 0;
  if (currency === "USD") {
    const rate = Number(exchangeRate) || 1;
    const usd = n / rate;
    return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return formatVND(n);
};

const parseNum = (v) => {
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
};

function roundTo(value, step) {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

// Compute totals for a single cost item, given pax count
function itemAmounts(item, pax) {
  const base = (Number(item.unitCost) || 0) * (Number(item.qty) || 0);
  const beforeVat = item.splitByPax && pax > 0 ? base / pax : base;
  const vat = beforeVat * ((Number(item.vatPercent) || 0) / 100);
  const afterVat = beforeVat + vat;
  return { beforeVat, vat, afterVat };
}

function categoryTotal(category, pax) {
  return category.items.reduce((sum, item) => sum + itemAmounts(item, pax).afterVat, 0);
}

function tourCostTotal(tour) {
  const pax = Math.max(1, Number(tour.pax) || 1);
  return tour.costCategories.reduce((sum, cat) => sum + categoryTotal(cat, pax), 0);
}

function tourPricing(tour) {
  const pax = Math.max(1, Number(tour.pax) || 1);
  const costPerPax = tourCostTotal(tour); // already per-pax basis since splitByPax divides totals; non-split items are per-pax line entries too
  const costTotalAll = costPerPax * pax;

  let profitPerPax = 0;
  if (tour.profitMode === "percent") {
    profitPerPax = costPerPax * ((Number(tour.profitPercent) || 0) / 100);
  } else {
    profitPerPax = Number(tour.profitFixed) || 0;
  }

  const sellPerPaxRaw = costPerPax + profitPerPax;
  const sellPerPaxRounded = roundTo(sellPerPaxRaw, Number(tour.roundTo) || 0);
  const sellTotal = sellPerPaxRounded * pax;
  const profitTotal = sellTotal - costTotalAll;

  return {
    pax,
    costPerPax,
    costTotalAll,
    profitPerPax,
    sellPerPaxRaw,
    sellPerPaxRounded,
    sellTotal,
    profitTotal,
  };
}

/* ============================================================
   STORAGE (localStorage)
   ============================================================ */

const STORAGE_KEY = "baogiatour_tours_v2";

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
   THEME
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
  gold: "#E8B800",
  goldLight: "#FDF6DC",
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
      .ta-input:focus, .ta-select:focus, .ta-textarea:focus { border-color: ${PALETTE.primary}; }
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
      .ta-card { background: ${PALETTE.surface}; border: 1px solid ${PALETTE.border}; border-radius: 14px; }
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
  appShell: { minHeight: "100vh", background: PALETTE.bg, fontFamily: "'Inter', sans-serif", color: PALETTE.ink },
  loadingScreen: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: PALETTE.bg },
  loadingSpinner: { width: 28, height: 28, border: `3px solid ${PALETTE.border}`, borderTopColor: PALETTE.primary, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  toast: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: PALETTE.ink, color: "white", padding: "10px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 500, zIndex: 999 },
};

const labelStyle = { display: "block", fontSize: 12.5, fontWeight: 500, color: PALETTE.textMuted, marginBottom: 6 };

function Field({ label, children, span }) {
  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

/* ============================================================
   ROOT APP
   ============================================================ */

export default function App() {
  const [tours, setTours] = useState(null);
  const [activeTourId, setActiveTourId] = useState(null);
  const [view, setView] = useState("list");
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
          onOpen={(id) => { setActiveTourId(id); setView("edit"); }}
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
   TOUR LIST (HOME)
   ============================================================ */

function TourList({ tours, onOpen, onCreate, onDuplicate, onDelete }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const sorted = [...tours].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: PALETTE.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Compass size={22} color="white" strokeWidth={2} />
          </div>
          <div>
            <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Báo giá tour
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: PALETTE.textMuted }}>{tours.length} tour đã lưu</p>
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
            const pricing = tourPricing(tour);
            return (
              <div
                key={tour.id}
                className="ta-card"
                style={{ overflow: "hidden", cursor: "pointer", position: "relative" }}
                onClick={() => onOpen(tour.id)}
              >
                {tour.coverImageUrl ? (
                  <div style={{ height: 110, background: `url(${tour.coverImageUrl}) center/cover`, position: "relative" }}>
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.4), transparent)" }} />
                  </div>
                ) : (
                  <div style={{ height: 110, background: PALETTE.primaryLight, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Compass size={28} color={PALETTE.primary} opacity={0.5} />
                  </div>
                )}
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600, fontFamily: "'Fraunces', serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tour.name || "Tour chưa đặt tên"}
                      </h3>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, color: PALETTE.textMuted, fontSize: 12.5 }}>
                        <MapPin size={13} />
                        <span>{tour.destination || "Chưa có điểm đến"}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20, background: PALETTE.primaryLight, color: PALETTE.primaryDark, flexShrink: 0 }}>
                      {tour.durationDays}N{tour.durationDays > 1 ? `${tour.durationDays - 1}Đ` : ""}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 14, margin: "12px 0 12px", fontSize: 12.5, color: PALETTE.textMuted }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}><Users size={13} /> {tour.pax} khách</div>
                    {tour.startDate && <div style={{ display: "flex", alignItems: "center", gap: 4 }}><Calendar size={13} /> {tour.startDate}</div>}
                  </div>

                  <div style={{ borderTop: `1px solid ${PALETTE.border}`, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                    <div>
                      <div style={{ fontSize: 11, color: PALETTE.textFaint }}>Giá bán/khách</div>
                      <div style={{ fontSize: 17, fontWeight: 600, color: PALETTE.primaryDark }}>{formatVND(pricing.sellPerPaxRounded)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: PALETTE.textFaint }}>Lợi nhuận</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: pricing.profitTotal >= 0 ? PALETTE.primary : PALETTE.danger }}>
                        {formatVND(pricing.profitTotal)}
                      </div>
                    </div>
                  </div>

                  <div className="no-print" style={{ display: "flex", gap: 4, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${PALETTE.border}` }} onClick={(e) => e.stopPropagation()}>
                    <button className="ta-btn ta-btn-ghost" style={{ flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12.5 }} onClick={() => onDuplicate(tour.id)}>
                      <Copy size={13} /> Sao chép
                    </button>
                    {confirmDeleteId === tour.id ? (
                      <button className="ta-btn" style={{ flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12.5, background: PALETTE.danger, color: "white" }}
                        onClick={() => { onDelete(tour.id); setConfirmDeleteId(null); }}>
                        <Check size={13} /> Xác nhận xoá
                      </button>
                    ) : (
                      <button className="ta-btn ta-btn-danger" style={{ flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12.5 }} onClick={() => setConfirmDeleteId(tour.id)}>
                        <Trash2 size={13} /> Xoá
                      </button>
                    )}
                  </div>
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
    <div style={{ textAlign: "center", padding: "80px 20px", border: `1px dashed ${PALETTE.borderStrong}`, borderRadius: 16, background: PALETTE.surface }}>
      <div style={{ width: 56, height: 56, borderRadius: 14, background: PALETTE.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        <Compass size={28} color={PALETTE.primary} />
      </div>
      <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, margin: "0 0 6px" }}>Chưa có tour nào</h3>
      <p style={{ color: PALETTE.textMuted, fontSize: 14, margin: "0 0 20px" }}>Tạo báo giá tour đầu tiên của bạn để bắt đầu</p>
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
  const setCompanyField = (key, value) => onChange((t) => ({ ...t, company: { ...t.company, [key]: value } }));

  const setDuration = (days) => {
    days = Math.max(1, Math.min(60, days));
    onChange((t) => {
      const itinerary = [...t.itinerary];
      while (itinerary.length < days) itinerary.push(newDay(itinerary.length + 1));
      while (itinerary.length > days) itinerary.pop();
      return { ...t, durationDays: days, itinerary };
    });
  };

  return (
    <div>
      <EditorTopBar tour={tour} onBack={onBack} onPreview={onPreview} />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 100px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TourBasicsCard tour={tour} setField={setField} setDuration={setDuration} />

          <div>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "8px 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <ClipboardList size={18} /> Lịch trình theo ngày
            </h2>
            <ItineraryEditor tour={tour} onChange={onChange} />
          </div>

          <div>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "8px 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <Wallet size={18} /> Bảng chi phí
            </h2>
            <CostCategoriesEditor tour={tour} onChange={onChange} pax={pricing.pax} />
          </div>

          <PricingSettingsCard tour={tour} setField={setField} pricing={pricing} />
          <CompanyInfoCard tour={tour} setCompanyField={setCompanyField} />

          <div className="ta-card" style={{ padding: 18 }}>
            <label style={labelStyle}>Ghi chú nội bộ</label>
            <textarea className="ta-textarea" rows={3} placeholder="Ghi chú riêng, không hiển thị cho khách..." value={tour.notes} onChange={(e) => setField("notes", e.target.value)} />
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
    <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(250,248,243,0.92)", backdropFilter: "blur(6px)", borderBottom: `1px solid ${PALETTE.border}` }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <button className="ta-btn ta-btn-ghost" onClick={onBack}><ArrowLeft size={16} /> Danh sách tour</button>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: PALETTE.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "center" }}>
          {tour.name || "Tour chưa đặt tên"}
        </div>
        <button className="ta-btn ta-btn-primary" onClick={onPreview}><Eye size={16} /> Xem báo giá</button>
      </div>
    </div>
  );
}

function TourBasicsCard({ tour, setField, setDuration }) {
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "0 0 14px" }}>Thông tin tour</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Tên tour" span={2}>
          <input className="ta-input" placeholder="VD: Khám phá Đà Nẵng - Hội An - Bà Nà Hills" value={tour.name} onChange={(e) => setField("name", e.target.value)} />
        </Field>
        <Field label="Ảnh bìa tour (URL)" span={2}>
          <input className="ta-input" placeholder="https://..." value={tour.coverImageUrl} onChange={(e) => setField("coverImageUrl", e.target.value)} />
        </Field>
        <Field label="Điểm đến">
          <input className="ta-input" placeholder="VD: Đà Nẵng" value={tour.destination} onChange={(e) => setField("destination", e.target.value)} />
        </Field>
        <Field label="Ngày khởi hành">
          <input className="ta-input" type="date" value={tour.startDate} onChange={(e) => setField("startDate", e.target.value)} />
        </Field>
        <Field label="Số ngày">
          <input className="ta-input" type="number" min={1} max={60} value={tour.durationDays} onChange={(e) => setDuration(parseInt(e.target.value) || 1)} />
        </Field>
        <Field label="Số lượng khách">
          <input className="ta-input" type="number" min={1} value={tour.pax} onChange={(e) => setField("pax", Math.max(1, parseInt(e.target.value) || 1))} />
        </Field>
      </div>
    </div>
  );
}

function CompanyInfoCard({ tour, setCompanyField }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", background: "none", border: "none", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: 0 }}>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: 0 }}>Thông tin công ty (in trên báo giá)</h2>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          <Field label="Tên công ty" span={2}><input className="ta-input" value={tour.company.name} onChange={(e) => setCompanyField("name", e.target.value)} /></Field>
          <Field label="Số điện thoại"><input className="ta-input" value={tour.company.phone} onChange={(e) => setCompanyField("phone", e.target.value)} /></Field>
          <Field label="Email"><input className="ta-input" value={tour.company.email} onChange={(e) => setCompanyField("email", e.target.value)} /></Field>
          <Field label="Địa chỉ" span={2}><input className="ta-input" value={tour.company.address} onChange={(e) => setCompanyField("address", e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}

function PricingSettingsCard({ tour, setField, pricing }) {
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <Percent size={17} /> Lợi nhuận & làm tròn giá
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 14 }}>
        {[
          { key: "percent", label: "Theo % chi phí" },
          { key: "fixed", label: "Số tiền cố định / khách" },
        ].map((m) => {
          const active = tour.profitMode === m.key;
          return (
            <button key={m.key} onClick={() => setField("profitMode", m.key)} style={{
              textAlign: "left", padding: "10px 12px", borderRadius: 10,
              border: `1.5px solid ${active ? PALETTE.primary : PALETTE.border}`,
              background: active ? PALETTE.primaryLight : PALETTE.surface, cursor: "pointer", fontFamily: "'Inter', sans-serif",
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? PALETTE.primaryDark : PALETTE.ink }}>{m.label}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {tour.profitMode === "percent" ? (
          <Field label={`Tỷ lệ lợi nhuận (${tour.profitPercent}%)`}>
            <input type="range" min={0} max={100} value={tour.profitPercent} onChange={(e) => setField("profitPercent", parseInt(e.target.value))} style={{ width: "100%" }} />
          </Field>
        ) : (
          <Field label="Lợi nhuận / khách (VNĐ)">
            <CurrencyInput value={tour.profitFixed} onChange={(v) => setField("profitFixed", v)} />
          </Field>
        )}
        <Field label="Làm tròn giá bán đến (VNĐ)">
          <select className="ta-select" value={tour.roundTo} onChange={(e) => setField("roundTo", parseInt(e.target.value))}>
            <option value={0}>Không làm tròn</option>
            <option value={1000}>1.000</option>
            <option value={10000}>10.000</option>
            <option value={50000}>50.000</option>
            <option value={100000}>100.000</option>
          </select>
        </Field>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${PALETTE.border}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Tiền tệ mặc định khi xem báo giá">
          <select className="ta-select" value={tour.displayCurrency} onChange={(e) => setField("displayCurrency", e.target.value)}>
            <option value="VND">VND (₫)</option>
            <option value="USD">USD ($)</option>
          </select>
        </Field>
        <Field label="Tỷ giá quy đổi (1 USD = ? VNĐ)">
          <CurrencyInput value={tour.exchangeRate} onChange={(v) => setField("exchangeRate", v)} />
        </Field>
      </div>
    </div>
  );
}

function CurrencyInput({ value, onChange }) {
  const [local, setLocal] = useState(value ? value.toLocaleString("vi-VN") : "");
  useEffect(() => { setLocal(value ? Number(value).toLocaleString("vi-VN") : ""); }, [value]);
  return (
    <input className="ta-input" inputMode="numeric" placeholder="0" value={local}
      onChange={(e) => { const n = parseNum(e.target.value); setLocal(n ? n.toLocaleString("vi-VN") : e.target.value); onChange(n); }}
      onBlur={() => setLocal(value ? Number(value).toLocaleString("vi-VN") : "")} />
  );
}

/* ============================================================
   ITINERARY EDITOR (days -> stops with photos)
   ============================================================ */

function ItineraryEditor({ tour, onChange }) {
  const updateDay = (dayId, updater) => {
    onChange((t) => ({ ...t, itinerary: t.itinerary.map((d) => (d.id === dayId ? updater(d) : d)) }));
  };
  const addStop = (dayId) => updateDay(dayId, (d) => ({ ...d, stops: [...d.stops, newStop()] }));
  const updateStop = (dayId, stopId, patch) =>
    updateDay(dayId, (d) => ({ ...d, stops: d.stops.map((s) => (s.id === stopId ? { ...s, ...patch } : s)) }));
  const removeStop = (dayId, stopId) =>
    updateDay(dayId, (d) => ({ ...d, stops: d.stops.filter((s) => s.id !== stopId) }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tour.itinerary.map((day) => (
        <DayCard
          key={day.id}
          day={day}
          onUpdate={(patch) => updateDay(day.id, (d) => ({ ...d, ...patch }))}
          onAddStop={() => addStop(day.id)}
          onUpdateStop={(stopId, patch) => updateStop(day.id, stopId, patch)}
          onRemoveStop={(stopId) => removeStop(day.id, stopId)}
        />
      ))}
    </div>
  );
}

function DayCard({ day, onUpdate, onAddStop, onUpdateStop, onRemoveStop }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="ta-card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer", background: PALETTE.surfaceAlt }} onClick={() => setCollapsed(!collapsed)}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: PALETTE.primary, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
          {day.dayNumber}
        </div>
        <input
          className="ta-input"
          placeholder={`Tiêu đề ngày ${day.dayNumber} (VD: Khám phá Hội An)`}
          value={day.title}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate({ title: e.target.value })}
          style={{ background: "white", flex: 1 }}
        />
        <span style={{ fontSize: 12, color: PALETTE.textMuted, whiteSpace: "nowrap" }}>{day.stops.length} điểm</span>
        {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </div>

      {!collapsed && (
        <div style={{ padding: 18 }}>
          <Field label="Mô tả chung trong ngày (tuỳ chọn)">
            <textarea className="ta-textarea" rows={2} placeholder="VD: Khởi hành sớm, ăn sáng tại khách sạn, di chuyển bằng xe riêng..." value={day.summary} onChange={(e) => onUpdate({ summary: e.target.value })} />
          </Field>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: PALETTE.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
                <MapPin size={14} /> Điểm dừng / hoạt động
              </span>
              <button className="ta-btn ta-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onAddStop}>
                <Plus size={12} /> Thêm điểm
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {day.stops.map((stop) => (
                <StopRow key={stop.id} stop={stop} onUpdate={(patch) => onUpdateStop(stop.id, patch)} onRemove={() => onRemoveStop(stop.id)} />
              ))}
              {day.stops.length === 0 && (
                <div style={{ fontSize: 12.5, color: PALETTE.textFaint, padding: "10px 4px" }}>Chưa có điểm dừng nào. Bấm "Thêm điểm" để bắt đầu.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StopRow({ stop, onUpdate, onRemove }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: 12, background: PALETTE.surfaceAlt, borderRadius: 10, alignItems: "flex-start" }}>
      <div style={{ width: 84, height: 64, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: PALETTE.surface, border: `1px solid ${PALETTE.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {stop.imageUrl ? (
          <img src={stop.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <Camera size={18} color={PALETTE.textFaint} />
        )}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <input className="ta-input" placeholder="Tên điểm đến (VD: Chùa Linh Ứng)" value={stop.name} onChange={(e) => onUpdate({ name: e.target.value })} style={{ padding: "7px 10px", fontSize: 13.5, fontWeight: 500 }} />
        <textarea className="ta-textarea" placeholder="Mô tả ngắn (tuỳ chọn)" rows={1} value={stop.description} onChange={(e) => onUpdate({ description: e.target.value })} style={{ padding: "7px 10px", fontSize: 12.5 }} />
        <input className="ta-input" placeholder="URL ảnh (dán link ảnh điểm đến)" value={stop.imageUrl} onChange={(e) => onUpdate({ imageUrl: e.target.value })} style={{ padding: "7px 10px", fontSize: 12 }} />
      </div>
      <button onClick={onRemove} aria-label="Xoá điểm dừng" style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.textFaint, padding: 4, flexShrink: 0 }}>
        <X size={16} />
      </button>
    </div>
  );
}

/* ============================================================
   COST CATEGORIES EDITOR (TourAI-style cost table)
   ============================================================ */

const UNIT_OPTIONS = ["Ngày", "Đêm", "Vé", "Bữa", "Cái", "Xe", "Người", "Chai", "Khoản"];

function CostCategoriesEditor({ tour, onChange, pax }) {
  const updateCategory = (catId, updater) => {
    onChange((t) => ({ ...t, costCategories: t.costCategories.map((c) => (c.id === catId ? updater(c) : c)) }));
  };

  const addCategory = () => {
    onChange((t) => ({ ...t, costCategories: [...t.costCategories, newCostCategory("Danh mục mới")] }));
  };
  const removeCategory = (catId) => {
    onChange((t) => ({ ...t, costCategories: t.costCategories.filter((c) => c.id !== catId) }));
  };
  const renameCategory = (catId, name) => updateCategory(catId, (c) => ({ ...c, name }));

  const addItem = (catId) => updateCategory(catId, (c) => ({ ...c, items: [...c.items, newCostItem()] }));
  const updateItem = (catId, itemId, patch) =>
    updateCategory(catId, (c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
  const removeItem = (catId, itemId) =>
    updateCategory(catId, (c) => ({ ...c, items: c.items.filter((i) => i.id !== itemId) }));

  return (
    <div className="ta-card" style={{ overflow: "hidden" }}>
      {/* Table header */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 110px 56px 90px 70px 110px 26px", gap: 8, padding: "10px 16px", background: PALETTE.gold, fontSize: 11, fontWeight: 700, color: "#3D3000" }}>
        <div>DỊCH VỤ</div>
        <div style={{ textAlign: "right" }}>ĐƠN GIÁ</div>
        <div style={{ textAlign: "right" }}>SL</div>
        <div>ĐVT</div>
        <div style={{ textAlign: "right" }}>VAT%</div>
        <div style={{ textAlign: "right" }}>SAU VAT</div>
        <div></div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {tour.costCategories.map((cat, catIdx) => {
          const total = categoryTotal(cat, pax);
          return (
            <div key={cat.id} style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
              {/* Category header row */}
              <div style={{ display: "grid", gridTemplateColumns: "1.6fr 110px 56px 90px 70px 110px 26px", gap: 8, alignItems: "center", padding: "8px 16px", background: PALETTE.goldLight }}>
                <input
                  className="ta-input"
                  value={cat.name}
                  onChange={(e) => renameCategory(cat.id, e.target.value)}
                  style={{ fontWeight: 700, fontSize: 13, background: "transparent", border: "none", padding: "4px 2px" }}
                  placeholder="Tên danh mục"
                />
                <div></div><div></div><div></div><div></div>
                <div style={{ textAlign: "right", fontWeight: 700, fontSize: 13, color: PALETTE.danger }}>{formatVND(total)}</div>
                <button onClick={() => removeCategory(cat.id)} aria-label="Xoá danh mục" style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.textFaint }}>
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Item rows */}
              {cat.items.map((item) => {
                const amounts = itemAmounts(item, pax);
                return (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 110px 56px 90px 70px 110px 26px", gap: 8, alignItems: "center", padding: "6px 16px" }}>
                    <input className="ta-input" placeholder="Tên dịch vụ" value={item.name} onChange={(e) => updateItem(cat.id, item.id, { name: e.target.value })} style={{ padding: "6px 9px", fontSize: 13 }} />
                    <input className="ta-input" inputMode="numeric" placeholder="0" value={item.unitCost ? Number(item.unitCost).toLocaleString("vi-VN") : ""} onChange={(e) => updateItem(cat.id, item.id, { unitCost: parseNum(e.target.value) })} style={{ padding: "6px 9px", fontSize: 13, textAlign: "right" }} />
                    <input className="ta-input" type="number" min={0} value={item.qty} onChange={(e) => updateItem(cat.id, item.id, { qty: parseNum(e.target.value) })} style={{ padding: "6px 9px", fontSize: 13, textAlign: "right" }} />
                    <input className="ta-input" list="unit-options" value={item.unit} onChange={(e) => updateItem(cat.id, item.id, { unit: e.target.value })} style={{ padding: "6px 9px", fontSize: 13 }} />
                    <input className="ta-input" type="number" min={0} max={100} value={item.vatPercent} onChange={(e) => updateItem(cat.id, item.id, { vatPercent: parseNum(e.target.value) })} style={{ padding: "6px 9px", fontSize: 13, textAlign: "right" }} />
                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600 }}>{formatVND(amounts.afterVat)}</div>
                    <button onClick={() => removeItem(cat.id, item.id)} aria-label="Xoá dòng" style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.textFaint }}>
                      <X size={14} />
                    </button>
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: 16, padding: "6px 16px 10px" }}>
                <button className="ta-btn ta-btn-ghost" style={{ padding: "3px 9px", fontSize: 11.5 }} onClick={() => addItem(cat.id)}>
                  <Plus size={11} /> Thêm dòng
                </button>
                {cat.items.length > 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: PALETTE.textMuted, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={cat.items.every((i) => i.splitByPax)}
                      onChange={(e) => updateCategory(cat.id, (c) => ({ ...c, items: c.items.map((i) => ({ ...i, splitByPax: e.target.checked })) }))}
                    />
                    Chia đều theo {pax} khách
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <datalist id="unit-options">
        {UNIT_OPTIONS.map((u) => <option key={u} value={u} />)}
      </datalist>

      <div style={{ padding: 14 }}>
        <button className="ta-btn ta-btn-ghost" onClick={addCategory}>
          <Folder size={14} /> Thêm danh mục chi phí
        </button>
      </div>
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
        {tour.costCategories.map((cat) => {
          const total = categoryTotal(cat, pricing.pax);
          if (total === 0) return null;
          return (
            <div key={cat.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: PALETTE.textMuted }}>{cat.name || "—"}</span>
              <span style={{ fontWeight: 500 }}>{formatVND(total)}</span>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${PALETTE.border}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <Row label="Chi phí / khách" value={formatVND(pricing.costPerPax)} muted />
        <Row label="Tổng chi phí" value={formatVND(pricing.costTotalAll)} muted small />
      </div>

      <div style={{ marginTop: 14, padding: "14px 16px", background: PALETTE.primaryLight, borderRadius: 10 }}>
        <Row label="Giá bán / khách" value={formatVND(pricing.sellPerPaxRounded)} big />
        <Row label="Tổng giá trị hợp đồng" value={formatVND(pricing.sellTotal)} small />
      </div>

      <div style={{ marginTop: 10, padding: "12px 16px", background: pricing.profitTotal >= 0 ? PALETTE.accentLight : PALETTE.dangerLight, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: pricing.profitTotal >= 0 ? PALETTE.accent : PALETTE.danger, display: "flex", alignItems: "center", gap: 6 }}>
          <TrendingUp size={14} /> Tổng lợi nhuận
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: pricing.profitTotal >= 0 ? PALETTE.accent : PALETTE.danger }}>
          {formatVND(pricing.profitTotal)}
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
      <span style={{ fontSize: big ? 22 : small ? 12.5 : 14, fontWeight: big ? 700 : 600, color: big ? PALETTE.primaryDark : muted ? PALETTE.textMuted : PALETTE.ink, fontFamily: big ? "'Fraunces', serif" : "'Inter', sans-serif" }}>
        {value}
      </span>
    </div>
  );
}

/* ============================================================
   QUOTE PREVIEW / PRINT
   ============================================================ */

function QuotePreview({ tour, onBack }) {
  const [mode, setMode] = useState("client");
  const [currency, setCurrency] = useState(tour.displayCurrency || "VND");
  const [exchangeRate, setExchangeRate] = useState(tour.exchangeRate || 25400);
  const pricing = tourPricing(tour);
  const handlePrint = () => window.print();

  return (
    <div>
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(250,248,243,0.95)", backdropFilter: "blur(6px)", borderBottom: `1px solid ${PALETTE.border}` }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <button className="ta-btn ta-btn-ghost" onClick={onBack}><ArrowLeft size={16} /> Quay lại chỉnh sửa</button>
          <div style={{ display: "flex", gap: 6, background: PALETTE.surfaceAlt, padding: 4, borderRadius: 10 }}>
            <button onClick={() => setMode("client")} className="ta-btn" style={{ background: mode === "client" ? PALETTE.surface : "transparent", border: "none", boxShadow: mode === "client" ? "0 1px 2px rgba(0,0,0,0.06)" : "none", color: mode === "client" ? PALETTE.ink : PALETTE.textMuted }}>
              <FileText size={15} /> Lịch trình (gửi khách)
            </button>
            <button onClick={() => setMode("internal")} className="ta-btn" style={{ background: mode === "internal" ? PALETTE.surface : "transparent", border: "none", boxShadow: mode === "internal" ? "0 1px 2px rgba(0,0,0,0.06)" : "none", color: mode === "internal" ? PALETTE.ink : PALETTE.textMuted }}>
              <Wallet size={15} /> Bảng chiết tính
            </button>
          </div>
          <button className="ta-btn ta-btn-primary" onClick={handlePrint}><Printer size={16} /> In / Xuất PDF</button>
        </div>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: PALETTE.textMuted, display: "flex", alignItems: "center", gap: 5 }}>
            <DollarSign size={13} /> Hiển thị tiền tệ:
          </span>
          <div style={{ display: "flex", gap: 4, background: PALETTE.surfaceAlt, padding: 3, borderRadius: 8 }}>
            {["VND", "USD"].map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className="ta-btn"
                style={{
                  padding: "5px 14px",
                  fontSize: 12.5,
                  background: currency === c ? PALETTE.surface : "transparent",
                  border: "none",
                  boxShadow: currency === c ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  color: currency === c ? PALETTE.ink : PALETTE.textMuted,
                  fontWeight: currency === c ? 600 : 500,
                }}
              >
                {c}
              </button>
            ))}
          </div>
          {currency === "USD" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: PALETTE.textMuted }}>Tỷ giá: 1 USD =</span>
              <input
                className="ta-input"
                inputMode="numeric"
                value={exchangeRate ? Number(exchangeRate).toLocaleString("vi-VN") : ""}
                onChange={(e) => setExchangeRate(parseNum(e.target.value))}
                style={{ width: 100, padding: "5px 8px", fontSize: 12.5 }}
              />
              <span style={{ fontSize: 12, color: PALETTE.textMuted }}>₫</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "32px 24px 80px" }}>
        <div id="print-area" style={{ maxWidth: 794, margin: "0 auto" }}>
          {mode === "client" ? (
            <ClientItineraryDoc tour={tour} pricing={pricing} currency={currency} exchangeRate={exchangeRate} />
          ) : (
            <CostBreakdownDoc tour={tour} pricing={pricing} currency={currency} exchangeRate={exchangeRate} />
          )}
        </div>
      </div>
    </div>
  );
}


function DocShell({ children, noPadding }) {
  return (
    <div className="ta-card" style={{ background: "white", padding: noPadding ? 0 : "48px 52px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden" }}>
      {children}
    </div>
  );
}

/* ---------- Client-facing itinerary with photos ---------- */

function ClientItineraryDoc({ tour, pricing, currency = "VND", exchangeRate = 25400 }) {
  const money = (vnd) => formatMoney(vnd, currency, exchangeRate);
  return (
    <DocShell noPadding>
      {tour.coverImageUrl && (
        <div style={{ height: 220, background: `url(${tour.coverImageUrl}) center/cover` }} />
      )}
      <div style={{ padding: "40px 52px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: `2px solid ${PALETTE.primary}` }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: PALETTE.primaryDark, fontFamily: "'Fraunces', serif" }}>{tour.company.name}</div>
            <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 4, lineHeight: 1.6 }}>
              {tour.company.address && <div>{tour.company.address}</div>}
              <div>{tour.company.phone}{tour.company.email ? ` · ${tour.company.email}` : ""}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: PALETTE.textFaint, textTransform: "uppercase" }}>Chương trình tour</div>
            {tour.startDate && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 4 }}>Khởi hành: {tour.startDate}</div>}
          </div>
        </div>

        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, margin: "0 0 8px", color: PALETTE.ink }}>
          {tour.name || "Chương trình tour"}
        </h1>
        <div style={{ display: "flex", gap: 18, fontSize: 13, color: PALETTE.textMuted, marginBottom: 28 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><MapPin size={14} /> {tour.destination || "—"}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Calendar size={14} /> {tour.durationDays} ngày {tour.durationDays > 1 ? `${tour.durationDays - 1} đêm` : ""}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Users size={14} /> {pricing.pax} khách</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {tour.itinerary.map((day) => (
            <div key={day.id} style={{ pageBreakInside: "avoid" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: PALETTE.primary, color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, fontFamily: "'Fraunces', serif", flexShrink: 0 }}>
                  {day.dayNumber}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: PALETTE.ink }}>
                  Ngày {day.dayNumber}{day.title ? `: ${day.title}` : ""}
                </div>
              </div>

              {day.summary && (
                <div style={{ fontSize: 13, color: PALETTE.textMuted, lineHeight: 1.7, marginBottom: 14, paddingLeft: 44 }}>{day.summary}</div>
              )}

              {day.stops.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, paddingLeft: 44 }}>
                  {day.stops.map((stop) => (
                    <div key={stop.id} className="ta-card" style={{ overflow: "hidden" }}>
                      {stop.imageUrl ? (
                        <div style={{ height: 100, background: `url(${stop.imageUrl}) center/cover` }} />
                      ) : (
                        <div style={{ height: 100, background: PALETTE.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <ImageIcon size={20} color={PALETTE.textFaint} />
                        </div>
                      )}
                      <div style={{ padding: "8px 12px" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: PALETTE.ink }}>{stop.name || "Điểm dừng"}</div>
                        {stop.description && <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 2, lineHeight: 1.5 }}>{stop.description}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, padding: "20px 24px", background: PALETTE.primaryLight, borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12.5, color: PALETTE.primaryDark, fontWeight: 600 }}>Giá tour trọn gói</div>
            <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 2 }}>{money(pricing.sellPerPaxRounded)} / khách × {pricing.pax} khách</div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: PALETTE.primaryDark, fontFamily: "'Fraunces', serif" }}>{money(pricing.sellTotal)}</div>
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: PALETTE.textFaint, lineHeight: 1.6 }}>
          Báo giá có giá trị tham khảo, có thể thay đổi tuỳ thời điểm và số lượng khách thực tế. Vui lòng liên hệ để được tư vấn và xác nhận chi tiết.
        </div>
      </div>
    </DocShell>
  );
}

/* ---------- Internal cost breakdown — TourAI style table ---------- */

function CostBreakdownDoc({ tour, pricing, currency = "VND", exchangeRate = 25400 }) {
  const money = (vnd) => formatMoney(vnd, currency, exchangeRate);
  return (
    <DocShell>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>BẢNG CHIẾT TÍNH</h1>
        <div style={{ fontSize: 15, fontWeight: 600, color: PALETTE.primary }}>{tour.name || "Tour chưa đặt tên"}</div>
        <div style={{ fontSize: 12.5, color: PALETTE.textMuted, marginTop: 4 }}>
          {tour.durationDays} ngày {tour.durationDays > 1 ? `${tour.durationDays - 1} đêm` : ""} · {pricing.pax} khách
          {tour.startDate ? ` · Khởi hành ${tour.startDate}` : ""}
          {currency === "USD" && ` · Tỷ giá 1 USD = ${Number(exchangeRate).toLocaleString("vi-VN")} ₫`}
        </div>
      </div>

      <div style={{ border: `1px solid ${PALETTE.border}`, borderRadius: 10, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "32px 1.6fr 90px 40px 60px 90px 50px 100px", background: PALETTE.gold, fontSize: 10.5, fontWeight: 700, color: "#3D3000" }}>
          <div style={cellHead}>STT</div>
          <div style={cellHead}>DỊCH VỤ</div>
          <div style={{ ...cellHead, textAlign: "right" }}>ĐƠN GIÁ</div>
          <div style={{ ...cellHead, textAlign: "right" }}>SL</div>
          <div style={cellHead}>ĐVT</div>
          <div style={{ ...cellHead, textAlign: "right" }}>TRƯỚC VAT</div>
          <div style={{ ...cellHead, textAlign: "right" }}>%VAT</div>
          <div style={{ ...cellHead, textAlign: "right" }}>SAU VAT</div>
        </div>

        {tour.costCategories.map((cat, catIdx) => {
          const total = categoryTotal(cat, pricing.pax);
          return (
            <React.Fragment key={cat.id}>
              <div style={{ display: "grid", gridTemplateColumns: "32px 1.6fr 90px 40px 60px 90px 50px 100px", background: PALETTE.goldLight, fontSize: 11.5, fontWeight: 700 }}>
                <div style={cell}>{toRoman(catIdx + 1)}</div>
                <div style={cell}>{cat.name}</div>
                <div style={cell}></div><div style={cell}></div><div style={cell}></div><div style={cell}></div><div style={cell}></div>
                <div style={{ ...cell, textAlign: "right", color: PALETTE.danger }}>{money(total)}</div>
              </div>
              {cat.items.map((item, itemIdx) => {
                const a = itemAmounts(item, pricing.pax);
                return (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "32px 1.6fr 90px 40px 60px 90px 50px 100px", fontSize: 11.5, borderTop: `1px solid ${PALETTE.border}` }}>
                    <div style={{ ...cell, color: PALETTE.textFaint }}>{itemIdx + 1}</div>
                    <div style={cell}>{item.name || "—"}</div>
                    <div style={{ ...cell, textAlign: "right", color: PALETTE.textMuted }}>{item.unitCost ? money(item.unitCost) : "-"}</div>
                    <div style={{ ...cell, textAlign: "right" }}>{item.qty}</div>
                    <div style={cell}>{item.unit}</div>
                    <div style={{ ...cell, textAlign: "right", color: PALETTE.textMuted }}>{money(a.beforeVat)}</div>
                    <div style={{ ...cell, textAlign: "right" }}>{item.vatPercent || 0}</div>
                    <div style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{money(a.afterVat)}</div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* Summary block */}
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 0, border: `1px solid ${PALETTE.border}`, borderRadius: 10, overflow: "hidden" }}>
        <SummaryLine label="Chi phí / khách" value={money(pricing.costPerPax)} />
        <SummaryLine label="Lợi nhuận / khách" value={money(pricing.profitPerPax)} />
        <SummaryLine label="Giá bán / khách (làm tròn)" value={money(pricing.sellPerPaxRounded)} highlight="gold" bold />
        <SummaryLine label="TỔNG GIÁ TRỊ HỢP ĐỒNG" value={money(pricing.sellTotal)} highlight="blue" bold big />
        <SummaryLine label="TỔNG CHI PHÍ" value={money(pricing.costTotalAll)} />
        <SummaryLine label="TỔNG LỢI NHUẬN" value={money(pricing.profitTotal)} highlight="green" bold />
      </div>

      {tour.notes && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: PALETTE.textMuted, marginBottom: 4 }}>Ghi chú nội bộ</div>
          <div style={{ fontSize: 12.5, color: PALETTE.ink, whiteSpace: "pre-line", lineHeight: 1.6 }}>{tour.notes}</div>
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 10.5, color: PALETTE.textFaint }}>NỘI BỘ — KHÔNG GỬI KHÁCH</div>
    </DocShell>
  );
}

const cellHead = { padding: "8px 10px" };
const cell = { padding: "7px 10px", display: "flex", alignItems: "center", color: PALETTE.ink };

function SummaryLine({ label, value, highlight, bold, big }) {
  const bg = highlight === "gold" ? PALETTE.goldLight : highlight === "blue" ? "#E8EAFB" : highlight === "green" ? PALETTE.primaryLight : "white";
  const color = highlight === "blue" ? "#3730D9" : highlight === "green" ? PALETTE.primaryDark : PALETTE.ink;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: big ? "12px 16px" : "9px 16px", background: bg, borderTop: `1px solid ${PALETTE.border}` }}>
      <span style={{ fontSize: big ? 13 : 12, fontWeight: bold ? 700 : 500, color }}>{label}</span>
      <span style={{ fontSize: big ? 18 : 13.5, fontWeight: bold ? 700 : 600, color, fontFamily: big ? "'Fraunces', serif" : "'Inter', sans-serif" }}>{value}</span>
    </div>
  );
}

function toRoman(num) {
  const romans = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let result = "";
  let n = num;
  for (const [sym, val] of romans) {
    while (n >= val) { result += sym; n -= val; }
  }
  return result;
}

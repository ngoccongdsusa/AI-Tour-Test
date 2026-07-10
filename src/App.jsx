import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, Trash2, Copy, Printer, ChevronDown, ChevronUp, MapPin, Calendar,
  Users, ArrowLeft, FileText, Wallet, Eye, Compass, X, Check, TrendingUp,
  ClipboardList, Image as ImageIcon, GripVertical, Folder, Percent, Camera,
  DollarSign, Share2, Link, Star, CheckCircle, XCircle, Lock,
  LayoutDashboard, Ticket, Building2, Bus, ChevronRight, Search,
  Hash, Tag, Clock, Edit3, BarChart2,
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
  qty: 1,       // SL (số lượng xe/phòng/người...)
  sessions: 1,  // Đêm/Lượt/Bữa
  unit: "Cái",
  vatPercent: 0,
  // costType: "variable" = Biến phí (CP/Khách = Đơn giá × Đêm/Lượt)
  //           "fixed"    = Định phí (CP/Khách = Đơn giá × SL × Đêm/Lượt ÷ pax)
  costType: "variable",
});

// A cost category, e.g. "Vận chuyển", "Ăn uống"... user can add/remove freely
const newCostCategory = (name = "") => ({
  id: uid(),
  name,
  items: [newCostItem()],
});

const DEFAULT_CATEGORIES = () => [
  { ...newCostCategory("Vận chuyển"), items: [{ ...newCostItem(), name: "Xe ...", unit: "Xe", costType: "fixed" }] },
  { ...newCostCategory("Ăn uống"), items: [{ ...newCostItem(), name: "Bữa chính", unit: "Bữa", costType: "variable" }] },
  { ...newCostCategory("Lưu trú"), items: [{ ...newCostItem(), name: "Khách sạn", unit: "Đêm", costType: "variable" }] },
  { ...newCostCategory("Tham quan"), items: [{ ...newCostItem(), name: "Vé tham quan", unit: "Vé", costType: "variable" }] },
  { ...newCostCategory("HDV"), items: [{ ...newCostItem(), name: "Công tác phí", unit: "Ngày", costType: "fixed" }] },
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
  content: "",  // HTML từ rich text editor
  meals: [],    // ["Sáng", "Trưa", "Tối"]
  summary: "",  // giữ lại để tương thích dữ liệu cũ
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
  highlights: "",   // HTML rich text — Điểm nổi bật
  includes: [],     // string[] — Tour bao gồm
  excludes: [],     // string[] — Tour không bao gồm
  costCategories: DEFAULT_CATEGORIES(),
  profitMode: "percent", // "percent" | "fixed"
  profitPercent: 10,
  profitFixed: 0,
  roundTo: 10000, // làm tròn giá bán đến bội số này (VNĐ)
  surcharges: [], // [{ id, name, amount, perPax: true }] — phụ thu tự chọn
  notes: "",
  company: {
    name: "Công ty Du lịch Việt Hành",
    phone: "0931 08 88 09",
    email: "info@viethanh-tour.vn",
    address: "",
    website: "",
    logo: "",
  },
  agent: {
    name: "",
    title: "",   // Chức danh
    phone: "",
    email: "",
    zalo: "",
  },
  itinerary: [newDay(1)],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/* ============================================================
   DATA MODELS — BÁO GIÁ VÉ / PHÒNG / XE
   ============================================================ */

// --- Vé tham quan ---
const newTicketItem = () => ({ id: uid(), name: "", type: "Người lớn", unitPrice: 0, qty: 1, note: "", imageUrl: "" });
const newTicketQuote = () => ({
  id: uid(), name: "", destination: "", visitDate: "", pax: 1,
  coverImageUrl: "",
  items: [newTicketItem()],
  note: "", agent: {}, company: {},
  createdAt: Date.now(), updatedAt: Date.now(),
});

// --- Phòng khách sạn ---
const newRoomItem = () => ({ id: uid(), roomType: "Phòng đôi", nights: 1, qty: 1, unitPrice: 0, board: "BB", note: "", imageUrl: "" });
const newHotelQuote = () => ({
  id: uid(), name: "", hotelName: "", location: "", checkIn: "", checkOut: "", nights: 1, pax: 1,
  coverImageUrl: "",
  items: [newRoomItem()],
  taxes: 0, taxPercent: 10, includeTax: false,
  note: "", agent: {}, company: {},
  createdAt: Date.now(), updatedAt: Date.now(),
});

// --- Báo giá xe ---
const VEHICLE_TYPES = ["Xe 4 chỗ", "Xe 7 chỗ", "Xe 16 chỗ", "Xe 29 chỗ", "Xe 35 chỗ", "Xe 45 chỗ", "Xe buýt"];
const newCarItem = () => ({ id: uid(), vehicleType: "Xe 16 chỗ", route: "", days: 1, qty: 1, unitPrice: 0, note: "", imageUrl: "" });
const newCarQuote = () => ({
  id: uid(), name: "", departure: "", destination: "", startDate: "", endDate: "", pax: 1,
  coverImageUrl: "",
  items: [newCarItem()],
  note: "", agent: {}, company: {},
  createdAt: Date.now(), updatedAt: Date.now(),
});

// Storage keys
const STORAGE_TICKETS = "baogiatour_tickets_v1";
const STORAGE_HOTELS  = "baogiatour_hotels_v1";
const STORAGE_CARS    = "baogiatour_cars_v1";

async function loadList(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}
async function saveList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
}

// Tính tổng cho từng loại quote
function ticketTotal(q) {
  return (q.items || []).reduce((s, i) => s + (Number(i.unitPrice)||0) * (Number(i.qty)||0), 0);
}
function hotelTotal(q) {
  const sub = (q.items || []).reduce((s, i) => s + (Number(i.unitPrice)||0) * (Number(i.qty)||0) * (Number(i.nights)||1), 0);
  return q.includeTax ? sub * (1 + (Number(q.taxPercent)||0)/100) : sub;
}
function carTotal(q) {
  return (q.items || []).reduce((s, i) => s + (Number(i.unitPrice)||0) * (Number(i.qty)||0) * (Number(i.days)||1), 0);
}

// Tất cả số tiền hiển thị bằng USD
const formatUSD = (n) => {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Alias để tránh sửa nhiều chỗ
const formatVND = formatUSD;

// formatMoney — giữ lại để không crash các chỗ đang dùng
// currency và exchangeRate không còn dùng, luôn trả về USD
const formatMoney = (amount) => formatUSD(amount);

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
  const unitCost = Number(item.unitCost) || 0;
  const qty      = Number(item.qty) || 0;
  const sessions = Number(item.sessions) || 1;
  // Tương thích ngược với dữ liệu cũ dùng splitByPax
  const isFixed = item.costType === "fixed" || item.splitByPax === true;

  // Biến phí theo khách: CP/Khách = Đơn giá × Đêm/Lượt  (không nhân SL, SL dùng để tính tổng tour)
  // Định phí theo tour:  CP/Khách = (Đơn giá × SL × Đêm/Lượt) ÷ pax
  let perPax = 0;
  let totalTour = 0;

  if (isFixed) {
    totalTour = unitCost * qty * sessions;
    perPax    = pax > 0 ? totalTour / pax : 0;
  } else {
    perPax    = unitCost * sessions;           // biến phí: mỗi khách trả đơn giá × đêm/lượt
    totalTour = perPax * pax;                  // tổng tour = nhân ngược lại
  }

  const vat              = perPax * ((Number(item.vatPercent) || 0) / 100);
  const afterVat         = perPax + vat;
  const totalTourAfterVat = isFixed ? afterVat * pax : totalTour * (1 + (Number(item.vatPercent) || 0) / 100);

  return { perPax, totalTour, vat, afterVat, totalTourAfterVat };
}

function categoryTotal(category, pax) {
  return category.items.reduce((sum, item) => sum + itemAmounts(item, pax).afterVat, 0);
}

function tourCostTotal(tour) {
  const pax = Math.max(1, Number(tour.pax) || 1);
  return (tour.costCategories || []).reduce((sum, cat) => sum + categoryTotal(cat, pax), 0);
}

function tourPricing(tour) {
  const pax = Math.max(1, Number(tour.pax) || 1);
  const costPerPax   = tourCostTotal(tour);
  const costTotalAll = costPerPax * pax;

  let profitPerPax = 0;
  if (tour.profitMode === "percent") {
    profitPerPax = costPerPax * ((Number(tour.profitPercent) || 0) / 100);
  } else {
    profitPerPax = Number(tour.profitFixed) || 0;
  }

  // Giá bán / khách (chưa gồm phụ thu)
  const sellPerPaxRaw     = costPerPax + profitPerPax;
  const sellPerPaxRounded = roundTo(sellPerPaxRaw, Number(tour.roundTo) || 0);
  const sellSubtotal      = sellPerPaxRounded * pax;   // giá bán × SL khách

  // Phụ thu — mỗi mục có: qty (số lượng), amount (đơn giá)
  // Tổng phụ thu = Σ (qty × amount)  — cộng thẳng vào tổng hợp đồng
  const surcharges = tour.surcharges || [];
  const surchargeTotalAll = surcharges.reduce((sum, s) => {
    return sum + (Number(s.qty) || 1) * (Number(s.amount) || 0);
  }, 0);

  const sellTotal   = sellSubtotal + surchargeTotalAll;
  const profitTotal = sellTotal - costTotalAll;

  return {
    pax, costPerPax, costTotalAll,
    profitPerPax, sellPerPaxRaw, sellPerPaxRounded,
    sellSubtotal, surchargeTotalAll, sellTotal, profitTotal,
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

// Encode sang base64url (URL-safe: thay +/= bằng -_~)
function toBase64Url(str) {
  // Dùng TextEncoder để xử lý đúng Unicode/tiếng Việt
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "~");
}

function fromBase64Url(encoded) {
  const base64 = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/~/g, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function publishTour(tour) {
  try {
    const publicData = { ...tour, notes: "" }; // ẩn ghi chú nội bộ
    const json = JSON.stringify(publicData);
    return toBase64Url(json);
  } catch (e) {
    console.error("Encode tour failed", e);
    return null;
  }
}

async function loadPublicTour(encoded) {
  try {
    const json = fromBase64Url(encoded);
    return JSON.parse(json);
  } catch (e) {
    console.error("Decode tour failed", e);
    return null;
  }
}

// ── Link gửi Sếp: encode toàn bộ tour + hash password ──
async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12); // 12 ký tự đầu
}

async function publishTourApproval(tour, password) {
  try {
    const pwHash = await hashPassword(password);
    const json = JSON.stringify(tour); // giữ nguyên toàn bộ kể cả ghi chú nội bộ
    const encoded = toBase64Url(json);
    return `${pwHash}.${encoded}`; // format: HASH12CHARS.BASE64DATA
  } catch (e) {
    console.error("Encode approval tour failed", e);
    return null;
  }
}

async function loadApprovalTour(payload, passwordInput) {
  try {
    const dotIndex = payload.indexOf(".");
    if (dotIndex === -1) return { error: "invalid" };
    const storedHash = payload.slice(0, dotIndex);
    const encoded    = payload.slice(dotIndex + 1);
    const inputHash  = await hashPassword(passwordInput);
    if (inputHash !== storedHash) return { error: "wrong_password" };
    const json = fromBase64Url(encoded);
    return { tour: JSON.parse(json) };
  } catch {
    return { error: "invalid" };
  }
}

// Publish/load cho 3 module báo giá
async function publishQuote(data) {
  try { return toBase64Url(JSON.stringify(data)); }
  catch (e) { console.error("Encode failed", e); return null; }
}
async function loadQuote(encoded) {
  try { return JSON.parse(fromBase64Url(encoded)); }
  catch (e) { console.error("Decode failed", e); return null; }
}

// Đọc URL hash — hỗ trợ cả 5 loại link
function getHashPayload() {
  try {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("/view/"))    return { type: "client",   data: hash.slice(6) };
    if (hash.startsWith("/approve/")) return { type: "approval", data: hash.slice(9) };
    if (hash.startsWith("/ticket/"))  return { type: "ticket",   data: hash.slice(8) };
    if (hash.startsWith("/hotel/"))   return { type: "hotel",    data: hash.slice(7) };
    if (hash.startsWith("/car/"))     return { type: "car",      data: hash.slice(5) };
    return null;
  } catch { return null; }
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
      @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
      * { box-sizing: border-box; }
      body, html { font-family: 'Montserrat', sans-serif; }
      .ta-input, .ta-select, .ta-textarea {
        font-family: 'Montserrat', sans-serif;
        border: 1px solid ${PALETTE.border};
        background: ${PALETTE.surface};
        border-radius: 8px;
        padding: 9px 11px;
        font-size: 13.5px;
        color: ${PALETTE.ink};
        width: 100%;
        outline: none;
        transition: border-color .15s;
      }
      .ta-input:focus, .ta-select:focus, .ta-textarea:focus { border-color: ${PALETTE.primary}; }
      .ta-input::placeholder, .ta-textarea::placeholder { color: ${PALETTE.textFaint}; }
      .ta-btn {
        font-family: 'Montserrat', sans-serif;
        font-weight: 600;
        font-size: 13px;
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
      h1,h2,h3,h4,h5 { font-family: 'Montserrat', sans-serif; }
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
  appShell: { minHeight: "100vh", background: PALETTE.bg, fontFamily: "'Montserrat', sans-serif", color: PALETTE.ink },
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
  // ── Tất cả hooks PHẢI khai báo trước bất kỳ conditional return nào ──
  const [tours, setTours] = useState(null);
  const [activeTourId, setActiveTourId] = useState(null);
  const [view, setView] = useState("list");
  const [toast, setToast] = useState(null);
  const [publicTour, setPublicTour] = useState(null);
  const [isPublicMode, setIsPublicMode] = useState(false);
  const [publicQuote, setPublicQuote] = useState(null); // { type, data } cho ticket/hotel/car
  // Dashboard section
  const [section, setSection] = useState("tours"); // "tours" | "tickets" | "hotels" | "cars"
  // 3 module mới
  const [tickets, setTickets] = useState(null);
  const [hotels,  setHotels]  = useState(null);
  const [cars,    setCars]    = useState(null);
  const [activeItemId, setActiveItemId] = useState(null);
  const saveTimer = useRef(null);

  const persist = useCallback((next) => {
    setTours(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveTours(next), 400);
  }, []);

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

  useEffect(() => {
    const payload = getHashPayload();
    if (payload?.type === "client") {
      setIsPublicMode(true);
      loadPublicTour(payload.data).then((t) => setPublicTour(t || "not_found"));
    } else if (payload?.type === "approval") {
      setIsPublicMode(true);
      setPublicTour({ __approvalPayload: payload.data });
    } else if (payload?.type === "ticket") {
      setIsPublicMode(true);
      loadQuote(payload.data).then((d) => setPublicQuote(d ? { type: "ticket", data: d } : "not_found"));
    } else if (payload?.type === "hotel") {
      setIsPublicMode(true);
      loadQuote(payload.data).then((d) => setPublicQuote(d ? { type: "hotel", data: d } : "not_found"));
    } else if (payload?.type === "car") {
      setIsPublicMode(true);
      loadQuote(payload.data).then((d) => setPublicQuote(d ? { type: "car", data: d } : "not_found"));
    } else {
      loadTours().then((t) => setTours(t));
      loadList(STORAGE_TICKETS).then(setTickets);
      loadList(STORAGE_HOTELS).then(setHotels);
      loadList(STORAGE_CARS).then(setCars);
    }
  }, []);

  // ── Sau khi tất cả hooks đã khai báo, mới được conditional return ──

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

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

  // Chế độ xem link public — ticket/hotel/car
  if (isPublicMode && publicQuote) {
    if (publicQuote === "not_found") {
      return (
        <div style={styles.loadingScreen}>
          <GlobalStyle />
          <Compass size={36} color={PALETTE.textFaint} />
          <p style={{ color: PALETTE.textMuted, fontSize: 14, marginTop: 12 }}>Không tìm thấy báo giá hoặc link đã hết hạn.</p>
        </div>
      );
    }
    return (
      <div style={styles.appShell}>
        <GlobalStyle />
        <PublicTourErrorBoundary>
          {publicQuote.type === "ticket" && <PublicTicketView data={publicQuote.data} />}
          {publicQuote.type === "hotel"  && <PublicHotelView  data={publicQuote.data} />}
          {publicQuote.type === "car"    && <PublicCarView    data={publicQuote.data} />}
        </PublicTourErrorBoundary>
      </div>
    );
  }

  // Đang load publicQuote hoặc publicTour
  if (isPublicMode && !publicTour && !publicQuote) {
    return (
      <div style={styles.loadingScreen}>
        <GlobalStyle />
        <div style={styles.loadingSpinner} />
        <p style={{ color: PALETTE.textMuted, fontSize: 14 }}>Đang tải báo giá...</p>
      </div>
    );
  }

  if (isPublicMode && publicTour) {
    if (!publicTour || publicTour === "loading") {
      return (
        <div style={styles.loadingScreen}>
          <GlobalStyle />
          <div style={styles.loadingSpinner} />
          <p style={{ color: PALETTE.textMuted, fontSize: 14 }}>Đang tải báo giá...</p>
        </div>
      );
    }
    if (publicTour?.__approvalPayload) {
      return (
        <div style={styles.appShell}>
          <GlobalStyle />
          <ApprovalPasswordGate payload={publicTour.__approvalPayload} />
        </div>
      );
    }
    if (publicTour === "not_found") {
      return (
        <div style={styles.loadingScreen}>
          <GlobalStyle />
          <Compass size={36} color={PALETTE.textFaint} />
          <p style={{ color: PALETTE.textMuted, fontSize: 14, marginTop: 12 }}>
            Không tìm thấy báo giá hoặc link đã hết hạn.
          </p>
        </div>
      );
    }
    return (
      <div style={styles.appShell}>
        <GlobalStyle />
        <PublicTourErrorBoundary>
          <PublicTourView tour={publicTour} />
        </PublicTourErrorBoundary>
      </div>
    );
  }

  // Helper persist cho 3 module mới
  const persistList = (key, setter, list) => {
    setter(list);
    saveList(key, list);
  };

  // Chế độ app bình thường
  if (tours === null || tickets === null || hotels === null || cars === null) {
    return (
      <div style={styles.loadingScreen}>
        <GlobalStyle />
        <div style={styles.loadingSpinner} />
        <p style={{ color: PALETTE.textMuted, fontSize: 14 }}>Đang tải dữ liệu...</p>
      </div>
    );
  }

  return (
    <div style={styles.appShell}>
      <GlobalStyle />
      {view === "list" && (
        <Dashboard
          section={section} setSection={setSection}
          tours={tours} onOpenTour={(id) => { setActiveTourId(id); setView("edit"); }}
          onCreateTour={createTour} onDuplicateTour={duplicateTour} onDeleteTour={deleteTour}
          tickets={tickets}
          onSaveTickets={(list) => persistList(STORAGE_TICKETS, setTickets, list)}
          hotels={hotels}
          onSaveHotels={(list) => persistList(STORAGE_HOTELS, setHotels, list)}
          cars={cars}
          onSaveCars={(list) => persistList(STORAGE_CARS, setCars, list)}
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
   DASHBOARD — sidebar navigation + 4 sections
   ============================================================ */

const NAV_ITEMS = [
  { key: "tours",   label: "Báo giá Tour",        Icon: Compass,   color: "#0F5D52" },
  { key: "tickets", label: "Báo giá Vé tham quan", Icon: Ticket,    color: "#7C3AED" },
  { key: "hotels",  label: "Báo giá Phòng KS",     Icon: Building2, color: "#0369A1" },
  { key: "cars",    label: "Báo giá Xe",            Icon: Bus,       color: "#B45309" },
];

function Dashboard({
  section, setSection,
  tours, onOpenTour, onCreateTour, onDuplicateTour, onDeleteTour,
  tickets, onSaveTickets,
  hotels,  onSaveHotels,
  cars,    onSaveCars,
}) {
  const allCounts = {
    tours:   tours.length,
    tickets: tickets.length,
    hotels:  hotels.length,
    cars:    cars.length,
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside style={{ width: 230, background: PALETTE.ink, display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
        {/* Logo */}
        <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: PALETTE.primary, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Compass size={18} color="white" />
            </div>
            <div>
              <div style={{ color: "white", fontWeight: 800, fontSize: 14, letterSpacing: "-0.01em" }}>TourQuote</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10.5 }}>Quản lý báo giá</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: "12px 10px", flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", padding: "4px 10px 8px", textTransform: "uppercase" }}>
            Modules
          </div>
          {NAV_ITEMS.map(({ key, label, Icon, color }) => {
            const active = section === key;
            return (
              <button key={key} onClick={() => setSection(key)} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
                borderRadius: 9, border: "none", cursor: "pointer", marginBottom: 2, textAlign: "left",
                background: active ? "rgba(255,255,255,0.1)" : "transparent",
                transition: "background .15s",
              }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: active ? color : "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background .15s" }}>
                  <Icon size={15} color={active ? "white" : "rgba(255,255,255,0.4)"} />
                </div>
                <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "white" : "rgba(255,255,255,0.55)", flex: 1, letterSpacing: "-0.01em" }}>
                  {label}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: active ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.08)", borderRadius: 20, padding: "1px 7px" }}>
                  {allCounts[key]}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Stats bottom */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Tổng báo giá</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "white", marginTop: 2 }}>
            {Object.values(allCounts).reduce((a, b) => a + b, 0)}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, background: PALETTE.bg, overflow: "auto" }}>
        {section === "tours" && (
          <TourList tours={tours} onOpen={onOpenTour} onCreate={onCreateTour} onDuplicate={onDuplicateTour} onDelete={onDeleteTour} />
        )}
        {section === "tickets" && (
          <GenericQuoteList
            type="tickets" title="Báo giá Vé tham quan" Icon={Ticket} color="#7C3AED"
            items={tickets} onSave={onSaveTickets}
            newItem={newTicketQuote} calcTotal={ticketTotal}
            renderEditor={(item, onChange, onClose) => <TicketEditor item={item} onChange={onChange} onClose={onClose} />}
            fields={[
              { key: "name", label: "Tên báo giá" },
              { key: "destination", label: "Địa điểm" },
              { key: "visitDate", label: "Ngày tham quan" },
            ]}
          />
        )}
        {section === "hotels" && (
          <GenericQuoteList
            type="hotels" title="Báo giá Phòng khách sạn" Icon={Building2} color="#0369A1"
            items={hotels} onSave={onSaveHotels}
            newItem={newHotelQuote} calcTotal={hotelTotal}
            renderEditor={(item, onChange, onClose) => <HotelEditor item={item} onChange={onChange} onClose={onClose} />}
            fields={[
              { key: "name", label: "Tên báo giá" },
              { key: "hotelName", label: "Khách sạn" },
              { key: "checkIn", label: "Check-in" },
            ]}
          />
        )}
        {section === "cars" && (
          <GenericQuoteList
            type="cars" title="Báo giá Xe" Icon={Bus} color="#B45309"
            items={cars} onSave={onSaveCars}
            newItem={newCarQuote} calcTotal={carTotal}
            renderEditor={(item, onChange, onClose) => <CarEditor item={item} onChange={onChange} onClose={onClose} />}
            fields={[
              { key: "name", label: "Tên báo giá" },
              { key: "departure", label: "Điểm đi" },
              { key: "startDate", label: "Ngày" },
            ]}
          />
        )}
      </main>
    </div>
  );
}

/* ============================================================
   GENERIC QUOTE LIST — dùng chung cho vé / phòng / xe
   ============================================================ */

function GenericQuoteList({ type, title, Icon, color, items, onSave, newItem, calcTotal, renderEditor, fields }) {
  const [editingItem, setEditingItem] = useState(null);
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  const filtered = search ? sorted.filter((i) => {
    const q = search.toLowerCase();
    return fields.some(f => (i[f.key] || "").toLowerCase().includes(q));
  }) : sorted;

  const createItem = () => {
    const item = newItem();
    onSave([item, ...items]);
    setEditingItem(item);
  };

  const updateItem = (patch) => {
    const updated = { ...editingItem, ...patch, updatedAt: Date.now() };
    setEditingItem(updated);
    onSave(items.map((i) => i.id === updated.id ? updated : i));
  };

  const deleteItem = (id) => {
    onSave(items.filter((i) => i.id !== id));
    if (editingItem?.id === id) setEditingItem(null);
    setConfirmDeleteId(null);
  };

  const duplicateItem = (item) => {
    const copy = { ...item, id: uid(), name: (item.name || "Báo giá") + " (bản sao)", createdAt: Date.now(), updatedAt: Date.now() };
    onSave([copy, ...items]);
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Left panel — danh sách */}
      <div style={{ width: 320, borderRight: `1px solid ${PALETTE.border}`, display: "flex", flexDirection: "column", background: PALETTE.surface }}>
        {/* Header */}
        <div style={{ padding: "18px 16px 12px", borderBottom: `1px solid ${PALETTE.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} color="white" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: PALETTE.ink }}>{title}</div>
                <div style={{ fontSize: 11, color: PALETTE.textMuted }}>{items.length} báo giá</div>
              </div>
            </div>
            <button className="ta-btn ta-btn-primary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={createItem}>
              <Plus size={13} /> Tạo mới
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <Search size={14} color={PALETTE.textFaint} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input className="ta-input" placeholder="Tìm kiếm..." value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32, padding: "7px 10px 7px 32px", fontSize: 12.5 }} />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <Icon size={28} color={PALETTE.textFaint} style={{ margin: "0 auto 10px", display: "block" }} />
              <div style={{ fontSize: 13, color: PALETTE.textMuted, fontWeight: 600 }}>Chưa có báo giá nào</div>
              <div style={{ fontSize: 12, color: PALETTE.textFaint, marginTop: 4 }}>Bấm "Tạo mới" để bắt đầu</div>
            </div>
          ) : (
            filtered.map((item) => {
              const total = calcTotal(item);
              const active = editingItem?.id === item.id;
              return (
                <div key={item.id}
                  onClick={() => setEditingItem(item)}
                  style={{ padding: "12px 14px", cursor: "pointer", borderBottom: `1px solid ${PALETTE.border}`, background: active ? `${color}12` : "transparent", borderLeft: active ? `3px solid ${color}` : "3px solid transparent", transition: "all .12s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: PALETTE.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name || "Chưa đặt tên"}
                      </div>
                      <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item[fields[1]?.key] || "—"}
                        {item[fields[2]?.key] ? ` · ${item[fields[2].key]}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: color }}>{formatVND(total)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                    <button className="ta-btn ta-btn-ghost" style={{ flex: 1, justifyContent: "center", padding: "3px 6px", fontSize: 11 }} onClick={() => duplicateItem(item)}>
                      <Copy size={11} /> Copy
                    </button>
                    {confirmDeleteId === item.id ? (
                      <button className="ta-btn" style={{ flex: 1, justifyContent: "center", padding: "3px 6px", fontSize: 11, background: PALETTE.danger, color: "white" }}
                        onClick={() => deleteItem(item.id)}>
                        <Check size={11} /> Xác nhận
                      </button>
                    ) : (
                      <button className="ta-btn ta-btn-danger" style={{ flex: 1, justifyContent: "center", padding: "3px 6px", fontSize: 11 }}
                        onClick={() => setConfirmDeleteId(item.id)}>
                        <Trash2 size={11} /> Xoá
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — editor */}
      <div style={{ flex: 1, overflow: "auto", background: PALETTE.bg }}>
        {editingItem ? (
          renderEditor(editingItem, updateItem, () => setEditingItem(null))
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: PALETTE.textMuted }}>
            <Icon size={36} color={PALETTE.textFaint} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Chọn một báo giá để chỉnh sửa</div>
            <div style={{ fontSize: 12, color: PALETTE.textFaint }}>hoặc bấm "Tạo mới" để bắt đầu</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   IMAGE INPUT — component dùng chung cho tất cả editor
   ============================================================ */

function ImageInput({ value, onChange, label = "URL ảnh", height = 120, placeholder = "Dán link ảnh (https://...)" }) {
  const [focused, setFocused] = useState(false);
  const hasImage = value && value.trim();
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: "relative" }}>
        {/* Preview ảnh */}
        {hasImage && (
          <div style={{ position: "relative", marginBottom: 6, borderRadius: 10, overflow: "hidden", height, background: PALETTE.surfaceAlt }}>
            <img
              src={value} alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
            />
            <div style={{ display: "none", position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6, background: PALETTE.surfaceAlt }}>
              <ImageIcon size={22} color={PALETTE.textFaint} />
              <span style={{ fontSize: 11, color: PALETTE.textFaint }}>Không tải được ảnh</span>
            </div>
            <button
              onClick={() => onChange("")}
              style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.55)", border: "none", borderRadius: "50%", width: 24, height: 24, cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {/* Input URL */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Camera size={14} color={PALETTE.textFaint} style={{ flexShrink: 0 }} />
          <input
            className="ta-input"
            placeholder={placeholder}
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{ fontSize: 12, padding: "6px 10px" }}
          />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SHARE QUOTE BUTTON — dùng chung cho Ticket/Hotel/Car
   ============================================================ */

function ShareQuoteButton({ data, routePrefix, color }) {
  const [shareLink, setShareLink] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    try {
      const encoded = await publishQuote(data);
      if (encoded) {
        const url = `${window.location.origin}${window.location.pathname}#/${routePrefix}/${encoded}`;
        setShareLink(url);
        await navigator.clipboard.writeText(url).catch(() => {});
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  return (
    <div>
      <button
        className="ta-btn"
        onClick={handleShare}
        disabled={loading}
        style={{ background: color, color: "white", padding: "8px 16px", fontSize: 13 }}
      >
        <Share2 size={15} /> {loading ? "Đang tạo..." : "Tạo link gửi khách"}
      </button>

      {shareLink && (
        <div style={{ marginTop: 10, padding: "10px 14px", background: PALETTE.primaryLight, borderRadius: 10, border: `1px solid ${PALETTE.primary}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link size={13} color={PALETTE.primary} />
            <input readOnly value={shareLink}
              style={{ flex: 1, border: "none", background: "transparent", fontSize: 11.5, color: PALETTE.primaryDark, outline: "none", fontFamily: "'Montserrat',sans-serif" }} />
            <button className="ta-btn ta-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }}
              onClick={() => navigator.clipboard.writeText(shareLink).catch(() => {})}>
              Copy
            </button>
            <button onClick={() => setShareLink(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.textFaint }}>
              <X size={13} />
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: PALETTE.textMuted, marginTop: 5 }}>
            ✓ Đã copy · Khách mở link xem báo giá (không cần đăng nhập)
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TICKET EDITOR — Báo giá vé tham quan
   ============================================================ */

function TicketEditor({ item, onChange, onClose }) {
  const total = ticketTotal(item);
  const set = (k, v) => onChange({ [k]: v });
  const setItem = (id, patch) => onChange({ items: (item.items||[]).map(i => i.id===id ? {...i,...patch} : i) });
  const addItem = () => onChange({ items: [...(item.items||[]), newTicketItem()] });
  const removeItem = (id) => onChange({ items: (item.items||[]).filter(i => i.id!==id) });

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ticket size={18} color="white" />
        </div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: PALETTE.ink }}>Báo giá Vé tham quan</h2>
      </div>

      {/* Thông tin chung + ảnh đại diện */}
      <div className="ta-card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Tên báo giá" span={2}>
            <input className="ta-input" placeholder="VD: Vé VinWonders Phú Quốc - Đoàn ABC" value={item.name||""} onChange={e=>set("name",e.target.value)}/>
          </Field>
          <Field label="Địa điểm / Khu vui chơi">
            <input className="ta-input" placeholder="VD: VinWonders Phú Quốc" value={item.destination||""} onChange={e=>set("destination",e.target.value)}/>
          </Field>
          <Field label="Ngày tham quan">
            <input className="ta-input" type="date" value={item.visitDate||""} onChange={e=>set("visitDate",e.target.value)}/>
          </Field>
          <Field label="Số lượng khách">
            <input className="ta-input" type="number" min={1} value={item.pax||1} onChange={e=>set("pax",parseInt(e.target.value)||1)}/>
          </Field>
        </div>
        {/* Ảnh đại diện khu vui chơi */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${PALETTE.border}` }}>
          <ImageInput
            label="🏞️ Ảnh đại diện khu vui chơi / điểm tham quan"
            value={item.coverImageUrl || ""}
            onChange={(v) => set("coverImageUrl", v)}
            height={140}
            placeholder="Dán link ảnh khu vui chơi (https://...)"
          />
        </div>
      </div>

      {/* Bảng vé — thêm cột ảnh */}
      <div className="ta-card" style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "80px 1.5fr 120px 70px 100px 26px", gap: 8, padding: "9px 16px", background: "#7C3AED", fontSize: 11, fontWeight: 700, color: "white" }}>
          <div>ẢNH VÉ</div><div>LOẠI VÉ</div><div style={{textAlign:"right"}}>ĐƠN GIÁ</div><div style={{textAlign:"right"}}>SL</div><div style={{textAlign:"right"}}>THÀNH TIỀN</div><div/>
        </div>
        {(item.items||[]).map((ti) => (
          <div key={ti.id} style={{ display: "grid", gridTemplateColumns: "80px 1.5fr 120px 70px 100px 26px", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${PALETTE.border}`, alignItems: "start" }}>
            {/* Ảnh loại vé */}
            <div>
              <div style={{ width: 72, height: 52, borderRadius: 8, overflow: "hidden", background: PALETTE.surfaceAlt, border: `1px solid ${PALETTE.border}`, marginBottom: 4, position: "relative" }}>
                {ti.imageUrl ? (
                  <img src={ti.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    onError={(e) => { e.target.style.display = "none"; }}/>
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Camera size={16} color={PALETTE.textFaint} />
                  </div>
                )}
              </div>
              <input className="ta-input" placeholder="URL ảnh" value={ti.imageUrl||""} onChange={e=>setItem(ti.id,{imageUrl:e.target.value})}
                style={{ padding: "3px 6px", fontSize: 10, width: "100%" }}/>
            </div>
            {/* Tên + loại */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input className="ta-input" placeholder="Tên loại vé" value={ti.name||""} onChange={e=>setItem(ti.id,{name:e.target.value})} style={{padding:"5px 9px",fontSize:13}}/>
              <select className="ta-select" value={ti.type||"Người lớn"} onChange={e=>setItem(ti.id,{type:e.target.value})} style={{padding:"4px 8px",fontSize:11.5}}>
                {["Người lớn","Trẻ em","Người cao tuổi","Miễn phí"].map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <input className="ta-input" inputMode="numeric" value={ti.unitPrice?Number(ti.unitPrice).toLocaleString("en-US"):""} onChange={e=>setItem(ti.id,{unitPrice:parseNum(e.target.value)})} style={{padding:"5px 9px",fontSize:13,textAlign:"right"}}/>
            <input className="ta-input" type="number" min={0} value={ti.qty||1} onChange={e=>setItem(ti.id,{qty:parseNum(e.target.value)})} style={{padding:"5px 9px",fontSize:13,textAlign:"right"}}/>
            <div style={{fontSize:13,fontWeight:600,color:"#7C3AED",textAlign:"right",paddingTop:4}}>{formatVND((Number(ti.unitPrice)||0)*(Number(ti.qty)||0))}</div>
            <button onClick={()=>removeItem(ti.id)} style={{background:"none",border:"none",cursor:"pointer",color:PALETTE.textFaint,paddingTop:4}}><X size={14}/></button>
          </div>
        ))}
        <div style={{padding:"8px 14px"}}>
          <button className="ta-btn ta-btn-ghost" style={{padding:"4px 10px",fontSize:12}} onClick={addItem}><Plus size={12}/> Thêm loại vé</button>
        </div>
      </div>

      {/* Tổng */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div className="ta-card" style={{ padding: "14px 20px", minWidth: 240 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, color: "#7C3AED" }}>
            <span>TỔNG TIỀN VÉ</span><span>{formatVND(total)}</span>
          </div>
          {item.pax > 0 && <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 4, textAlign: "right" }}>= {formatVND(total/item.pax)} / khách</div>}
        </div>
      </div>

      <div style={{marginTop:14}}>
        <Field label="Ghi chú"><textarea className="ta-textarea" rows={2} value={item.note||""} onChange={e=>set("note",e.target.value)} placeholder="Điều kiện vé, hạn sử dụng..."/></Field>
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${PALETTE.border}` }}>
        <ShareQuoteButton data={item} routePrefix="ticket" color="#7C3AED" />
      </div>
    </div>
  );
}

/* ============================================================
   HOTEL EDITOR — Báo giá phòng khách sạn
   ============================================================ */

const BOARD_OPTIONS = [
  { v: "RO", l: "RO - Room Only" }, { v: "BB", l: "BB - Bed & Breakfast" },
  { v: "HB", l: "HB - Half Board" }, { v: "FB", l: "FB - Full Board" }, { v: "AI", l: "AI - All Inclusive" },
];

function HotelEditor({ item, onChange, onClose }) {
  const subTotal = (item.items||[]).reduce((s,i)=>s+(Number(i.unitPrice)||0)*(Number(i.qty)||0)*(Number(i.nights)||1),0);
  const tax = item.includeTax ? subTotal * (Number(item.taxPercent)||0)/100 : 0;
  const total = subTotal + tax;
  const set = (k, v) => onChange({ [k]: v });
  const setItem = (id, patch) => onChange({ items: (item.items||[]).map(i=>i.id===id?{...i,...patch}:i) });
  const addItem = () => onChange({ items: [...(item.items||[]), newRoomItem()] });
  const removeItem = (id) => onChange({ items: (item.items||[]).filter(i=>i.id!==id) });

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: "#0369A1", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Building2 size={18} color="white" />
        </div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Báo giá Phòng khách sạn</h2>
      </div>

      {/* Thông tin chung */}
      <div className="ta-card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <Field label="Tên báo giá" span={2}><input className="ta-input" placeholder="VD: Phòng KS Intercontinental Đà Nẵng" value={item.name||""} onChange={e=>set("name",e.target.value)}/></Field>
          <Field label="Tên khách sạn"><input className="ta-input" placeholder="VD: InterContinental Danang" value={item.hotelName||""} onChange={e=>set("hotelName",e.target.value)}/></Field>
          <Field label="Địa điểm"><input className="ta-input" placeholder="VD: Đà Nẵng" value={item.location||""} onChange={e=>set("location",e.target.value)}/></Field>
          <Field label="Ngày Check-in"><input className="ta-input" type="date" value={item.checkIn||""} onChange={e=>set("checkIn",e.target.value)}/></Field>
          <Field label="Ngày Check-out"><input className="ta-input" type="date" value={item.checkOut||""} onChange={e=>set("checkOut",e.target.value)}/></Field>
          <Field label="Số đêm"><input className="ta-input" type="number" min={1} value={item.nights||1} onChange={e=>set("nights",parseInt(e.target.value)||1)}/></Field>
          <Field label="Số lượng khách"><input className="ta-input" type="number" min={1} value={item.pax||1} onChange={e=>set("pax",parseInt(e.target.value)||1)}/></Field>
        </div>
        {/* Ảnh đại diện khách sạn */}
        <div style={{ paddingTop: 14, borderTop: `1px solid ${PALETTE.border}` }}>
          <ImageInput
            label="🏨 Ảnh đại diện khách sạn"
            value={item.coverImageUrl || ""}
            onChange={(v) => set("coverImageUrl", v)}
            height={150}
            placeholder="Dán link ảnh khách sạn (https://...)"
          />
        </div>
      </div>

      {/* Bảng phòng — thêm cột ảnh phòng */}
      <div className="ta-card" style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "88px 1.2fr 90px 50px 50px 120px 70px 70px 26px", gap: 6, padding: "9px 14px", background: "#0369A1", fontSize: 10, fontWeight: 700, color: "white" }}>
          <div>ẢNH PHÒNG</div><div>LOẠI PHÒNG</div><div>DỊCH VỤ</div><div style={{textAlign:"right"}}>SL</div><div style={{textAlign:"right"}}>ĐÊM</div><div style={{textAlign:"right"}}>ĐƠN GIÁ/ĐÊM</div><div style={{textAlign:"right"}}>THÀNH TIỀN</div><div>BOARD</div><div/>
        </div>
        {(item.items||[]).map((ri) => {
          const lineTotal = (Number(ri.unitPrice)||0)*(Number(ri.qty)||0)*(Number(ri.nights)||1);
          return (
            <div key={ri.id} style={{ display: "grid", gridTemplateColumns: "88px 1.2fr 90px 50px 50px 120px 70px 70px 26px", gap: 6, padding: "10px 14px", borderBottom:`1px solid ${PALETTE.border}`, alignItems:"start" }}>
              {/* Ảnh loại phòng */}
              <div>
                <div style={{ width: 80, height: 56, borderRadius: 8, overflow: "hidden", background: PALETTE.surfaceAlt, border: `1px solid ${PALETTE.border}`, marginBottom: 4 }}>
                  {ri.imageUrl ? (
                    <img src={ri.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { e.target.style.display = "none"; }}/>
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Camera size={16} color={PALETTE.textFaint} />
                    </div>
                  )}
                </div>
                <input className="ta-input" placeholder="URL ảnh" value={ri.imageUrl||""} onChange={e=>setItem(ri.id,{imageUrl:e.target.value})}
                  style={{ padding: "3px 5px", fontSize: 9.5, width: "100%" }}/>
              </div>
              <input className="ta-input" placeholder="VD: Deluxe Sea View" value={ri.roomType||""} onChange={e=>setItem(ri.id,{roomType:e.target.value})} style={{padding:"5px 8px",fontSize:12.5}}/>
              <input className="ta-input" placeholder="VD: KS" value={ri.service||""} onChange={e=>setItem(ri.id,{service:e.target.value})} style={{padding:"5px 8px",fontSize:12}}/>
              <input className="ta-input" type="number" min={1} value={ri.qty||1} onChange={e=>setItem(ri.id,{qty:parseNum(e.target.value)})} style={{padding:"5px 8px",fontSize:12,textAlign:"right"}}/>
              <input className="ta-input" type="number" min={1} value={ri.nights||item.nights||1} onChange={e=>setItem(ri.id,{nights:parseNum(e.target.value)})} style={{padding:"5px 8px",fontSize:12,textAlign:"right"}}/>
              <input className="ta-input" inputMode="numeric" value={ri.unitPrice?Number(ri.unitPrice).toLocaleString("en-US"):""} onChange={e=>setItem(ri.id,{unitPrice:parseNum(e.target.value)})} style={{padding:"5px 8px",fontSize:12,textAlign:"right"}}/>
              <div style={{fontSize:12.5,fontWeight:600,color:"#0369A1",textAlign:"right",paddingTop:4}}>{formatVND(lineTotal)}</div>
              <select className="ta-select" value={ri.board||"BB"} onChange={e=>setItem(ri.id,{board:e.target.value})} style={{padding:"4px 6px",fontSize:11}}>
                {BOARD_OPTIONS.map(b=><option key={b.v} value={b.v}>{b.v}</option>)}
              </select>
              <button onClick={()=>removeItem(ri.id)} style={{background:"none",border:"none",cursor:"pointer",color:PALETTE.textFaint,paddingTop:4}}><X size={14}/></button>
            </div>
          );
        })}
        <div style={{padding:"8px 14px"}}>
          <button className="ta-btn ta-btn-ghost" style={{padding:"4px 10px",fontSize:12}} onClick={addItem}><Plus size={12}/> Thêm loại phòng</button>
        </div>
      </div>

      {/* Tax + Tổng */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div className="ta-card" style={{ padding: "12px 16px", flex: 1 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={!!item.includeTax} onChange={e=>set("includeTax",e.target.checked)}/>
            <span>Tính thuế & phí dịch vụ</span>
            {item.includeTax && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input className="ta-input" type="number" min={0} max={100} value={item.taxPercent||10} onChange={e=>set("taxPercent",parseNum(e.target.value))} style={{width:54,padding:"4px 6px",fontSize:12}}/>
                <span style={{fontSize:12}}>%</span>
              </span>
            )}
          </label>
          {item.includeTax && <div style={{fontSize:11.5,color:PALETTE.textMuted,marginTop:4}}>Thuế: {formatVND(tax)}</div>}
        </div>
        <div className="ta-card" style={{ padding: "14px 20px", minWidth: 240 }}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:PALETTE.textMuted,marginBottom:4}}>
            <span>Subtotal</span><span>{formatVND(subTotal)}</span>
          </div>
          {item.includeTax && <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:PALETTE.textMuted,marginBottom:4}}>
            <span>Thuế ({item.taxPercent||10}%)</span><span>{formatVND(tax)}</span>
          </div>}
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14,fontWeight:800,color:"#0369A1",borderTop:`1px solid ${PALETTE.border}`,paddingTop:8}}>
            <span>TỔNG CỘNG</span><span>{formatVND(total)}</span>
          </div>
          {item.pax>0 && <div style={{fontSize:11.5,color:PALETTE.textMuted,marginTop:3,textAlign:"right"}}>{formatVND(total/item.pax)} / khách</div>}
        </div>
      </div>

      <div style={{marginTop:14}}>
        <Field label="Ghi chú"><textarea className="ta-textarea" rows={2} value={item.note||""} onChange={e=>set("note",e.target.value)} placeholder="Điều kiện đặt phòng, chính sách hủy..."/></Field>
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${PALETTE.border}` }}>
        <ShareQuoteButton data={item} routePrefix="hotel" color="#0369A1" />
      </div>
    </div>
  );
}

/* ============================================================
   CAR EDITOR — Báo giá xe
   ============================================================ */

function CarEditor({ item, onChange, onClose }) {
  const total = carTotal(item);
  const set = (k, v) => onChange({ [k]: v });
  const setItem = (id, patch) => onChange({ items: (item.items||[]).map(i=>i.id===id?{...i,...patch}:i) });
  const addItem = () => onChange({ items: [...(item.items||[]), newCarItem()] });
  const removeItem = (id) => onChange({ items: (item.items||[]).filter(i=>i.id!==id) });

  return (
    <div style={{ padding: 24, maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: "#B45309", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Bus size={18} color="white" />
        </div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Báo giá Xe</h2>
      </div>

      <div className="ta-card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Tên báo giá" span={2}><input className="ta-input" placeholder="VD: Xe đón đoàn Hà Nội - Hạ Long" value={item.name||""} onChange={e=>set("name",e.target.value)}/></Field>
          <Field label="Điểm đi"><input className="ta-input" placeholder="VD: Hà Nội" value={item.departure||""} onChange={e=>set("departure",e.target.value)}/></Field>
          <Field label="Điểm đến"><input className="ta-input" placeholder="VD: Hạ Long" value={item.destination||""} onChange={e=>set("destination",e.target.value)}/></Field>
          <Field label="Ngày bắt đầu"><input className="ta-input" type="date" value={item.startDate||""} onChange={e=>set("startDate",e.target.value)}/></Field>
          <Field label="Ngày kết thúc"><input className="ta-input" type="date" value={item.endDate||""} onChange={e=>set("endDate",e.target.value)}/></Field>
          <Field label="Số lượng khách"><input className="ta-input" type="number" min={1} value={item.pax||1} onChange={e=>set("pax",parseInt(e.target.value)||1)}/></Field>
        </div>
        {/* Ảnh đại diện */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${PALETTE.border}` }}>
          <ImageInput
            label="🚌 Ảnh đại diện tuyến xe / phương tiện"
            value={item.coverImageUrl || ""}
            onChange={(v) => set("coverImageUrl", v)}
            height={140}
            placeholder="Dán link ảnh xe / tuyến đường (https://...)"
          />
        </div>
      </div>

      <div className="ta-card" style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "88px 1.1fr 1fr 50px 50px 120px 100px 26px", gap: 6, padding: "9px 14px", background: "#B45309", fontSize: 10.5, fontWeight: 700, color: "white" }}>
          <div>ẢNH XE</div><div>LOẠI XE</div><div>TUYẾN ĐƯỜNG</div><div style={{textAlign:"right"}}>SL</div><div style={{textAlign:"right"}}>NGÀY</div><div style={{textAlign:"right"}}>ĐƠN GIÁ/NGÀY</div><div style={{textAlign:"right"}}>THÀNH TIỀN</div><div/>
        </div>
        {(item.items||[]).map((ci) => {
          const lineTotal = (Number(ci.unitPrice)||0)*(Number(ci.qty)||0)*(Number(ci.days)||1);
          return (
            <div key={ci.id} style={{ display: "grid", gridTemplateColumns: "88px 1.1fr 1fr 50px 50px 120px 100px 26px", gap: 6, padding: "10px 14px", borderBottom:`1px solid ${PALETTE.border}`, alignItems:"start" }}>
              {/* Ảnh loại xe */}
              <div>
                <div style={{ width: 80, height: 56, borderRadius: 8, overflow: "hidden", background: PALETTE.surfaceAlt, border: `1px solid ${PALETTE.border}`, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {ci.imageUrl ? (
                    <img src={ci.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { e.target.style.display = "none"; }}/>
                  ) : (
                    <Bus size={20} color={PALETTE.textFaint} />
                  )}
                </div>
                <input className="ta-input" placeholder="URL ảnh xe" value={ci.imageUrl||""} onChange={e=>setItem(ci.id,{imageUrl:e.target.value})}
                  style={{ padding: "3px 5px", fontSize: 9.5, width: "100%" }}/>
              </div>
              <select className="ta-select" value={ci.vehicleType||"Xe 16 chỗ"} onChange={e=>setItem(ci.id,{vehicleType:e.target.value})} style={{padding:"5px 8px",fontSize:12.5}}>
                {VEHICLE_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
              <input className="ta-input" placeholder="VD: Hà Nội - Hạ Long khứ hồi" value={ci.route||""} onChange={e=>setItem(ci.id,{route:e.target.value})} style={{padding:"5px 8px",fontSize:12.5}}/>
              <input className="ta-input" type="number" min={1} value={ci.qty||1} onChange={e=>setItem(ci.id,{qty:parseNum(e.target.value)})} style={{padding:"5px 8px",fontSize:12,textAlign:"right"}}/>
              <input className="ta-input" type="number" min={1} value={ci.days||1} onChange={e=>setItem(ci.id,{days:parseNum(e.target.value)})} style={{padding:"5px 8px",fontSize:12,textAlign:"right"}}/>
              <input className="ta-input" inputMode="numeric" value={ci.unitPrice?Number(ci.unitPrice).toLocaleString("en-US"):""} onChange={e=>setItem(ci.id,{unitPrice:parseNum(e.target.value)})} style={{padding:"5px 8px",fontSize:12,textAlign:"right"}}/>
              <div style={{fontSize:12.5,fontWeight:600,color:"#B45309",textAlign:"right",paddingTop:4}}>{formatVND(lineTotal)}</div>
              <button onClick={()=>removeItem(ci.id)} style={{background:"none",border:"none",cursor:"pointer",color:PALETTE.textFaint,paddingTop:4}}><X size={14}/></button>
            </div>
          );
        })}
        <div style={{padding:"8px 14px"}}>
          <button className="ta-btn ta-btn-ghost" style={{padding:"4px 10px",fontSize:12}} onClick={addItem}><Plus size={12}/> Thêm xe</button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        {item.pax > 0 && <div style={{fontSize:12.5,color:PALETTE.textMuted}}>CP/khách: <strong>{formatVND(total/(item.pax||1))}</strong></div>}
        <div className="ta-card" style={{ padding: "14px 20px", minWidth: 220 }}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:14,fontWeight:800,color:"#B45309"}}>
            <span>TỔNG CHI PHÍ XE</span><span>{formatVND(total)}</span>
          </div>
        </div>
      </div>

      <div style={{marginTop:14}}>
        <Field label="Ghi chú"><textarea className="ta-textarea" rows={2} value={item.note||""} onChange={e=>set("note",e.target.value)} placeholder="Điều khoản thuê xe, phụ phí..."/></Field>
      </div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${PALETTE.border}` }}>
        <ShareQuoteButton data={item} routePrefix="car" color="#B45309" />
      </div>
    </div>
  );
}


/* ============================================================
   TOUR LIST (HOME) — giờ dùng trong Dashboard
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
            <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
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
                      <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600, fontFamily: "'Montserrat', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
      <h3 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 19, margin: "0 0 6px" }}>Chưa có tour nào</h3>
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
  const setAgentField = (key, value) => onChange((t) => ({ ...t, agent: { ...(t.agent || {}), [key]: value } }));

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

          {/* Điểm nổi bật */}
          <RichTextCard
            title="✦ Điểm nổi bật"
            value={tour.highlights || ""}
            onChange={(v) => setField("highlights", v)}
            placeholder="Nhập điểm nổi bật của tour... (hỗ trợ in đậm, danh sách bullet)"
          />

          {/* Tour bao gồm / không bao gồm */}
          <IncludesCard tour={tour} setField={setField} />

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "8px 0 12px" }}>
              <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <ClipboardList size={18} /> Lịch trình theo ngày
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: PALETTE.textMuted }}>Số ngày:</span>
                {[1,2,3,4,5,6,7].map((d) => (
                  <button key={d} onClick={() => setDuration(d)} style={{
                    width: 30, height: 30, borderRadius: 8,
                    border: `1.5px solid ${tour.durationDays === d ? PALETTE.primary : PALETTE.border}`,
                    background: tour.durationDays === d ? PALETTE.primary : PALETTE.surface,
                    color: tour.durationDays === d ? "white" : PALETTE.ink,
                    cursor: "pointer", fontFamily: "'Montserrat', sans-serif",
                    fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{d}</button>
                ))}
              </div>
            </div>
            <ItineraryEditor tour={tour} onChange={onChange} />
          </div>

          <div>
            <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, margin: "8px 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <Wallet size={18} /> Bảng chi phí
            </h2>
            <CostCategoriesEditor tour={tour} onChange={onChange} pax={pricing.pax} />
          </div>

          <PricingSettingsCard tour={tour} setField={setField} pricing={pricing} />
          <CompanyInfoCard tour={tour} setCompanyField={setCompanyField} setAgentField={setAgentField} />

          <div className="ta-card" style={{ padding: 18 }}>
            <label style={labelStyle}>Ghi chú nội bộ</label>
            <textarea className="ta-textarea" rows={3} placeholder="Ghi chú riêng, không hiển thị cho khách..." value={tour.notes} onChange={(e) => setField("notes", e.target.value)} />
          </div>
        </div>

        <div style={{ position: "sticky", top: 88, alignSelf: "start" }}>
          <SummaryPanel pricing={pricing} tour={tour} onChange={onChange} onPreview={onPreview} />
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
        <div style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 15, fontWeight: 600, color: PALETTE.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "center" }}>
          {tour.name || "Tour chưa đặt tên"}
        </div>
        <button className="ta-btn ta-btn-primary" onClick={onPreview}><Eye size={16} /> Xem báo giá</button>
      </div>
    </div>
  );
}

/* ---- Shared Rich Text Editor (dùng lại cho Lịch trình, Điểm nổi bật) ---- */
function RichTextCard({ title, value, onChange, placeholder, accentColor }) {
  const editorRef = useRef(null);
  const isComposing = useRef(false);
  const accent = accentColor || PALETTE.primary;

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== (value || "")) {
      editorRef.current.innerHTML = value || "";
    }
  }, []); // chỉ chạy khi mount

  const execCmd = (cmd, val = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    onChange(editorRef.current?.innerHTML || "");
  };

  return (
    <div className="ta-card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "12px 18px 10px", borderBottom: `1px solid ${PALETTE.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <Star size={16} color={accent} />
        <span style={{ fontWeight: 700, fontSize: 14, color: PALETTE.ink }}>{title}</span>
      </div>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", background: PALETTE.surfaceAlt, borderBottom: `1px solid ${PALETTE.border}`, flexWrap: "wrap" }}>
        {[["B","bold",{fontWeight:700}],["I","italic",{fontStyle:"italic"}],["U","underline",{textDecoration:"underline"}]].map(([label,cmd,st]) => (
          <button key={cmd} onMouseDown={(e)=>{e.preventDefault();execCmd(cmd);}}
            style={{...st, padding:"3px 9px", border:`1px solid ${PALETTE.border}`, borderRadius:6, cursor:"pointer", background:PALETTE.surface, fontSize:13, fontFamily:"'Montserrat',sans-serif"}}>
            {label}
          </button>
        ))}
        <div style={{width:1,height:20,background:PALETTE.border,margin:"0 3px"}}/>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("insertUnorderedList");}}
          style={{padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>
          ☰ Bullet
        </button>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("insertOrderedList");}}
          style={{padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>
          1. Số
        </button>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("formatBlock","h4");}}
          style={{padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>
          Tiêu đề
        </button>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("formatBlock","p");}}
          style={{padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>
          Đoạn
        </button>
        <div style={{width:1,height:20,background:PALETTE.border,margin:"0 3px"}}/>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("removeFormat");}}
          style={{padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:11,color:PALETTE.textMuted}}>
          ✕ Xoá định dạng
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onCompositionStart={()=>{isComposing.current=true;}}
        onCompositionEnd={()=>{isComposing.current=false; onChange(editorRef.current?.innerHTML||"");}}
        onInput={()=>{if(!isComposing.current) onChange(editorRef.current?.innerHTML||"");}}
        data-placeholder={placeholder}
        style={{ minHeight:100, padding:"14px 18px", outline:"none", fontSize:13.5, lineHeight:1.8, color:PALETTE.ink, fontFamily:"'Montserrat',sans-serif" }}
      />
      <style>{`
        [contenteditable]:empty:before{content:attr(data-placeholder);color:#9CA39D;pointer-events:none;}
        [contenteditable] h4{font-size:14px;font-weight:700;margin:10px 0 4px;color:${accent};}
        [contenteditable] ul,[contenteditable] ol{margin:6px 0 6px 20px;padding:0;}
        [contenteditable] li{margin-bottom:3px;}
        [contenteditable] p{margin:4px 0;}
      `}</style>
    </div>
  );
}

/* ---- Tour bao gồm / Không bao gồm ---- */
function IncludesCard({ tour, setField }) {
  const addItem = (key) => setField(key, [...(tour[key] || []), ""]);
  const updateItem = (key, idx, val) => setField(key, (tour[key]||[]).map((v,i)=>i===idx?val:v));
  const removeItem = (key, idx) => setField(key, (tour[key]||[]).filter((_,i)=>i!==idx));

  return (
    <div className="ta-card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "12px 18px 10px", borderBottom: `1px solid ${PALETTE.border}` }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Tour bao gồm / Không bao gồm</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {[
          { key: "includes", label: "✓ Tour bao gồm", color: PALETTE.primary, icon: <CheckCircle size={14} color={PALETTE.primary}/> },
          { key: "excludes", label: "✗ Tour không bao gồm", color: PALETTE.danger, icon: <XCircle size={14} color={PALETTE.danger}/> },
        ].map(({ key, label, color, icon }) => (
          <div key={key} style={{ padding: 16, borderRight: key === "includes" ? `1px solid ${PALETTE.border}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color, display:"flex", alignItems:"center", gap:5 }}>{icon}{label}</span>
              <button className="ta-btn ta-btn-ghost" style={{ padding:"2px 8px", fontSize:11 }} onClick={()=>addItem(key)}>
                <Plus size={11}/> Thêm
              </button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {(tour[key]||[]).map((item, idx) => (
                <div key={idx} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ color, flexShrink:0, fontSize:14 }}>{key==="includes"?"✓":"✗"}</span>
                  <input className="ta-input" value={item} placeholder="Nhập nội dung..."
                    onChange={(e)=>updateItem(key, idx, e.target.value)}
                    style={{ padding:"6px 9px", fontSize:12.5, flex:1 }}/>
                  <button onClick={()=>removeItem(key,idx)} style={{ background:"none",border:"none",cursor:"pointer",color:PALETTE.textFaint,flexShrink:0 }}>
                    <X size={14}/>
                  </button>
                </div>
              ))}
              {(tour[key]||[]).length === 0 && (
                <div style={{ fontSize:12, color:PALETTE.textFaint, fontStyle:"italic" }}>Chưa có mục nào</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourBasicsCard({ tour, setField, setDuration }) {
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, margin: "0 0 14px" }}>Thông tin tour</h2>
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

function CompanyInfoCard({ tour, setCompanyField, setAgentField }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ta-card" style={{ overflow: "hidden" }}>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", background: "none", border: "none", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "16px 18px" }}>
        <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 16, fontWeight: 700, margin: 0 }}>
          🏢 Thông tin công ty & Người báo giá
        </h2>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Thông tin công ty */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: PALETTE.primary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Thông tin công ty</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Tên công ty" span={2}>
                <input className="ta-input" value={tour.company.name} onChange={(e) => setCompanyField("name", e.target.value)} />
              </Field>
              <Field label="Số điện thoại">
                <input className="ta-input" value={tour.company.phone} onChange={(e) => setCompanyField("phone", e.target.value)} />
              </Field>
              <Field label="Email">
                <input className="ta-input" value={tour.company.email} onChange={(e) => setCompanyField("email", e.target.value)} />
              </Field>
              <Field label="Website">
                <input className="ta-input" placeholder="https://..." value={tour.company.website || ""} onChange={(e) => setCompanyField("website", e.target.value)} />
              </Field>
              <Field label="Địa chỉ">
                <input className="ta-input" value={tour.company.address} onChange={(e) => setCompanyField("address", e.target.value)} />
              </Field>
              <Field label="Logo công ty (URL ảnh)" span={2}>
                <input className="ta-input" placeholder="https://..." value={tour.company.logo || ""} onChange={(e) => setCompanyField("logo", e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Thông tin người báo giá */}
          <div style={{ paddingTop: 16, borderTop: `1px solid ${PALETTE.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: PALETTE.accent, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Người báo giá</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Họ và tên">
                <input className="ta-input" placeholder="Nguyễn Văn A" value={tour.agent?.name || ""} onChange={(e) => setAgentField("name", e.target.value)} />
              </Field>
              <Field label="Chức danh">
                <input className="ta-input" placeholder="Sales Manager" value={tour.agent?.title || ""} onChange={(e) => setAgentField("title", e.target.value)} />
              </Field>
              <Field label="Số điện thoại / Hotline">
                <input className="ta-input" placeholder="0901 234 567" value={tour.agent?.phone || ""} onChange={(e) => setAgentField("phone", e.target.value)} />
              </Field>
              <Field label="Email">
                <input className="ta-input" placeholder="sales@company.vn" value={tour.agent?.email || ""} onChange={(e) => setAgentField("email", e.target.value)} />
              </Field>
              <Field label="Zalo" span={2}>
                <input className="ta-input" placeholder="Số Zalo liên hệ" value={tour.agent?.zalo || ""} onChange={(e) => setAgentField("zalo", e.target.value)} />
              </Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingSettingsCard({ tour, setField, pricing }) {
  return (
    <div className="ta-card" style={{ padding: 18 }}>
      <h2 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 18, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
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
              background: active ? PALETTE.primaryLight : PALETTE.surface, cursor: "pointer", fontFamily: "'Montserrat', sans-serif",
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
          <Field label="Lợi nhuận / khách ($)">
            <CurrencyInput value={tour.profitFixed} onChange={(v) => setField("profitFixed", v)} />
          </Field>
        )}
        <Field label="Làm tròn giá bán đến ($)">
          <select className="ta-select" value={tour.roundTo} onChange={(e) => setField("roundTo", parseInt(e.target.value))}>
            <option value={0}>Không làm tròn</option>
            <option value={1}>1</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

function CurrencyInput({ value, onChange }) {
  const [local, setLocal] = useState(value ? Number(value).toLocaleString("en-US") : "");
  useEffect(() => { setLocal(value ? Number(value).toLocaleString("en-US") : ""); }, [value]);
  return (
    <input className="ta-input" inputMode="numeric" placeholder="0"
      value={local}
      onChange={(e) => { const n = parseNum(e.target.value); setLocal(n ? n.toLocaleString("en-US") : e.target.value); onChange(n); }}
      onBlur={() => setLocal(value ? Number(value).toLocaleString("en-US") : "")} />
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
      {(tour.itinerary || []).map((day) => (
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
  const meals = day.meals || [];

  return (
    <div className="ta-card" style={{ overflow: "hidden", borderRadius: 12 }}>
      {/* Header accordion kiểu RootTrip */}
      <div style={{ display:"flex", alignItems:"center", background: collapsed ? PALETTE.primaryLight : PALETTE.primary, cursor:"pointer", transition:"background .2s" }}
        onClick={() => setCollapsed(!collapsed)}>
        <div style={{ minWidth:52, alignSelf:"stretch", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"12px 0", background:PALETTE.primaryDark, color:"white" }}>
          <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.08em", opacity:0.7 }}>NGÀY</span>
          <span style={{ fontSize:20, fontWeight:800, lineHeight:1 }}>{day.dayNumber}</span>
        </div>
        <input
          className="ta-input"
          placeholder={`Tiêu đề ngày ${day.dayNumber} (VD: Đón sân bay – Tham quan – Ăn tối)`}
          value={day.title}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate({ title: e.target.value })}
          style={{ flex:1, background:"transparent", border:"none", outline:"none", color: collapsed ? PALETTE.primaryDark : "white", fontWeight:700, fontSize:13.5, padding:"0 14px", fontFamily:"'Montserrat',sans-serif" }}
        />
        {/* Tags bữa ăn */}
        <div style={{ display:"flex", gap:4, padding:"0 10px", flexShrink:0 }} onClick={(e)=>e.stopPropagation()}>
          {["Sáng","Trưa","Tối"].map((meal) => {
            const active = meals.includes(meal);
            return (
              <button key={meal} onClick={()=>{
                const next = active ? meals.filter(m=>m!==meal) : [...meals,meal];
                onUpdate({meals:next});
              }} style={{ padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:700, cursor:"pointer", border:"none",
                background: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.15)",
                color: active ? PALETTE.primaryDark : "rgba(255,255,255,0.75)" }}>
                {meal}
              </button>
            );
          })}
        </div>
        <div style={{ padding:"0 12px", color: collapsed ? PALETTE.primary : "rgba(255,255,255,0.8)" }}>
          {collapsed ? <ChevronDown size={18}/> : <ChevronUp size={18}/>}
        </div>
      </div>

      {!collapsed && (
        <div>
          {/* Ảnh điểm tham quan — đặt TRÊN ĐẦU */}
          <div style={{ padding: "14px 16px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: PALETTE.textMuted, display: "flex", alignItems: "center", gap: 5 }}>
                <Camera size={13} /> Ảnh điểm tham quan
              </span>
              <button className="ta-btn ta-btn-ghost" style={{ padding: "3px 9px", fontSize: 11 }} onClick={onAddStop}>
                <Plus size={11} /> Thêm ảnh
              </button>
            </div>
            {day.stops.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, marginBottom: 12 }}>
                {day.stops.map((stop) => (
                  <StopCard key={stop.id} stop={stop}
                    onUpdate={(patch) => onUpdateStop(stop.id, patch)}
                    onRemove={() => onRemoveStop(stop.id)} />
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: PALETTE.textFaint, marginBottom: 10 }}>
                Thêm ảnh điểm tham quan để hiển thị trong bản gửi khách
              </div>
            )}
          </div>

          {/* Rich text nội dung — đặt DƯỚI ảnh */}
          <InlineRichText value={day.content || ""} onChange={(v) => onUpdate({ content: v })}
            placeholder="Nhập nội dung lịch trình ngày này... (hỗ trợ in đậm, bullet list, tiêu đề)" />
        </div>
      )}
    </div>
  );
}

/* Inline rich text toolbar — dùng trong DayCard (không có card wrapper) */
function InlineRichText({ value, onChange, placeholder }) {
  const editorRef = useRef(null);
  const isComposing = useRef(false);
  useEffect(()=>{
    if(editorRef.current && editorRef.current.innerHTML!==(value||""))
      editorRef.current.innerHTML = value||"";
  }, []); // chỉ mount
  const execCmd=(cmd,val=null)=>{editorRef.current?.focus();document.execCommand(cmd,false,val);onChange(editorRef.current?.innerHTML||"");};
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:4, padding:"7px 12px", background:PALETTE.surfaceAlt, borderBottom:`1px solid ${PALETTE.border}`, flexWrap:"wrap" }}>
        {[["B","bold",{fontWeight:700}],["I","italic",{fontStyle:"italic"}],["U","underline",{textDecoration:"underline"}]].map(([label,cmd,st])=>(
          <button key={cmd} onMouseDown={(e)=>{e.preventDefault();execCmd(cmd);}}
            style={{...st, padding:"3px 9px", border:`1px solid ${PALETTE.border}`, borderRadius:6, cursor:"pointer", background:PALETTE.surface, fontSize:13}}>
            {label}
          </button>
        ))}
        <div style={{width:1,height:20,background:PALETTE.border,margin:"0 3px"}}/>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("insertUnorderedList");}} style={{ padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>☰ Bullet</button>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("insertOrderedList");}} style={{ padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>1. Số</button>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("formatBlock","h4");}} style={{ padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>Tiêu đề</button>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("formatBlock","p");}} style={{ padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:12}}>Đoạn</button>
        <div style={{width:1,height:20,background:PALETTE.border,margin:"0 3px"}}/>
        <button onMouseDown={(e)=>{e.preventDefault();execCmd("removeFormat");}} style={{ padding:"3px 9px",border:`1px solid ${PALETTE.border}`,borderRadius:6,cursor:"pointer",background:PALETTE.surface,fontSize:11,color:PALETTE.textMuted}}>✕ Xoá định dạng</button>
      </div>
      <div ref={editorRef} contentEditable suppressContentEditableWarning
        onCompositionStart={()=>{isComposing.current=true;}}
        onCompositionEnd={()=>{isComposing.current=false;onChange(editorRef.current?.innerHTML||"");}}
        onInput={()=>{if(!isComposing.current)onChange(editorRef.current?.innerHTML||"");}}
        data-placeholder={placeholder}
        style={{ minHeight:110, padding:"14px 18px", outline:"none", fontSize:13.5, lineHeight:1.8, color:PALETTE.ink }}
      />
      <style>{`
        [contenteditable]:empty:before{content:attr(data-placeholder);color:#9CA39D;pointer-events:none;}
        [contenteditable] h4{font-size:14px;font-weight:700;margin:10px 0 4px;color:${PALETTE.primary};}
        [contenteditable] ul,[contenteditable] ol{margin:6px 0 6px 20px;padding:0;}
        [contenteditable] li{margin-bottom:3px;}
        [contenteditable] p{margin:4px 0;}
      `}</style>
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
      {/* Table header — thêm cột TỔNG CHI PHÍ TOUR */}
      <div style={{ display: "grid", gridTemplateColumns: "1.8fr 100px 46px 60px 70px 50px 110px 110px 26px", gap: 6, padding: "10px 16px", background: PALETTE.gold, fontSize: 10.5, fontWeight: 700, color: "#3D3000" }}>
        <div>KHOẢN MỤC</div>
        <div style={{ textAlign: "right" }}>ĐƠN GIÁ</div>
        <div style={{ textAlign: "right" }}>SL</div>
        <div style={{ textAlign: "right" }}>Đêm/Lượt</div>
        <div>ĐVT</div>
        <div style={{ textAlign: "right" }}>VAT%</div>
        <div style={{ textAlign: "right" }}>TỔNG CP TOUR</div>
        <div style={{ textAlign: "right" }}>CP/KHÁCH</div>
        <div></div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {(tour.costCategories || []).map((cat, catIdx) => {
          const total = categoryTotal(cat, pax);
          const totalTourCat = cat.items.reduce((s, item) => s + itemAmounts(item, pax).totalTourAfterVat, 0);
          return (
            <div key={cat.id} style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
              {/* Category header row */}
              <div style={{ display: "grid", gridTemplateColumns: "1.8fr 100px 46px 60px 70px 50px 110px 110px 26px", gap: 6, alignItems: "center", padding: "8px 16px", background: PALETTE.goldLight }}>
                <input
                  className="ta-input"
                  value={cat.name}
                  onChange={(e) => renameCategory(cat.id, e.target.value)}
                  style={{ fontWeight: 700, fontSize: 13, background: "transparent", border: "none", padding: "4px 2px" }}
                  placeholder="Tên danh mục"
                />
                <div></div><div></div><div></div><div></div><div></div>
                <div style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: PALETTE.danger }}>{formatVND(totalTourCat)}</div>
                <div style={{ textAlign: "right", fontWeight: 700, fontSize: 12, color: PALETTE.primaryDark }}>{formatVND(total)}</div>
                <button onClick={() => removeCategory(cat.id)} aria-label="Xoá danh mục" style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.textFaint }}>
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Item rows */}
              {cat.items.map((item) => {
                const amounts = itemAmounts(item, pax);
                const isFixed = item.costType === "fixed" || item.splitByPax === true;
                return (
                  <div key={item.id} style={{ borderTop: `1px solid ${PALETTE.border}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.8fr 100px 46px 60px 70px 50px 110px 110px 26px", gap: 6, alignItems: "center", padding: "6px 16px" }}>
                      <input className="ta-input" placeholder="Tên khoản mục" value={item.name} onChange={(e) => updateItem(cat.id, item.id, { name: e.target.value })} style={{ padding: "6px 9px", fontSize: 12.5 }} />
                      <input className="ta-input" inputMode="numeric" placeholder="0" value={item.unitCost ? Number(item.unitCost).toLocaleString("en-US") : ""} onChange={(e) => updateItem(cat.id, item.id, { unitCost: parseNum(e.target.value) })} style={{ padding: "6px 9px", fontSize: 12.5, textAlign: "right" }} />
                      <input className="ta-input" type="number" min={0} value={item.qty} onChange={(e) => updateItem(cat.id, item.id, { qty: parseNum(e.target.value) })} style={{ padding: "6px 9px", fontSize: 12.5, textAlign: "right" }} />
                      <input className="ta-input" type="number" min={0} value={item.sessions ?? 1} onChange={(e) => updateItem(cat.id, item.id, { sessions: parseNum(e.target.value) })} style={{ padding: "6px 9px", fontSize: 12.5, textAlign: "right" }} />
                      <input className="ta-input" list="unit-options" value={item.unit} onChange={(e) => updateItem(cat.id, item.id, { unit: e.target.value })} style={{ padding: "6px 9px", fontSize: 12.5 }} />
                      <input className="ta-input" type="number" min={0} max={100} value={item.vatPercent} onChange={(e) => updateItem(cat.id, item.id, { vatPercent: parseNum(e.target.value) })} style={{ padding: "6px 9px", fontSize: 12.5, textAlign: "right" }} />
                      <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: PALETTE.danger }}>{formatVND(amounts.totalTourAfterVat)}</div>
                      <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: PALETTE.primaryDark }}>{formatVND(amounts.afterVat)}</div>
                      <button onClick={() => removeItem(cat.id, item.id)} aria-label="Xoá dòng" style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.textFaint }}>
                        <X size={14} />
                      </button>
                    </div>
                    {/* Tag Biến phí / Định phí */}
                    <div style={{ display: "flex", gap: 6, padding: "0 16px 7px", alignItems: "center" }}>
                      {[
                        { v: "variable", label: "Biến phí theo khách", desc: `CP/Khách = Đơn giá × Đêm/Lượt` },
                        { v: "fixed",    label: "Định phí theo tour",   desc: `CP/Khách = Tổng / ${pax} khách` },
                      ].map(({ v, label, desc }) => {
                        const active = isFixed ? v === "fixed" : v === "variable";
                        return (
                          <button key={v} onClick={() => updateItem(cat.id, item.id, { costType: v, splitByPax: v === "fixed" })}
                            title={desc}
                            style={{
                              padding: "2px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, cursor: "pointer", border: "none",
                              background: active ? (v === "variable" ? PALETTE.primaryLight : PALETTE.accentLight) : PALETTE.surfaceAlt,
                              color:      active ? (v === "variable" ? PALETTE.primaryDark  : PALETTE.accent)      : PALETTE.textFaint,
                            }}>
                            {label}
                          </button>
                        );
                      })}
                      <span style={{ fontSize: 10.5, color: PALETTE.textFaint, marginLeft: 4 }}>
                        {isFixed
                          ? `= ${formatVND(Number(item.unitCost)||0)} × ${item.qty||1} × ${item.sessions||1} ÷ ${pax} khách`
                          : `= ${formatVND(Number(item.unitCost)||0)} × ${item.sessions||1} /khách`}
                      </span>
                    </div>
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: 16, padding: "6px 16px 10px" }}>
                <button className="ta-btn ta-btn-ghost" style={{ padding: "3px 9px", fontSize: 11.5 }} onClick={() => addItem(cat.id)}>
                  <Plus size={11} /> Thêm dòng
                </button>
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

function SummaryPanel({ pricing, tour, onChange, onPreview }) {
  const setSurcharges   = (s) => onChange((t) => ({ ...t, surcharges: s }));
  const addSurcharge    = () => setSurcharges([...(tour.surcharges || []), { id: uid(), name: "", qty: 1, amount: 0 }]);
  const updateSurcharge = (id, patch) => setSurcharges((tour.surcharges || []).map((s) => s.id === id ? { ...s, ...patch } : s));
  const removeSurcharge = (id) => setSurcharges((tour.surcharges || []).filter((s) => s.id !== id));

  return (
    <div className="ta-card" style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 16, fontWeight: 700, margin: "0 0 14px", display: "flex", alignItems: "center", gap: 7 }}>
        <Wallet size={16} /> Tổng kết tài chính
      </h2>

      {/* Chi phí theo danh mục */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 10 }}>
        {(tour.costCategories || []).map((cat) => {
          const total = categoryTotal(cat, pricing.pax);
          if (total === 0) return null;
          return (
            <div key={cat.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: PALETTE.textMuted }}>{cat.name || "—"}</span>
              <span style={{ fontWeight: 500 }}>{formatVND(total)}</span>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${PALETTE.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
        <Row label="Chi phí / khách" value={formatVND(pricing.costPerPax)} muted />
        <Row label="Tổng chi phí" value={formatVND(pricing.costTotalAll)} muted small />
      </div>

      {/* Giá bán / khách */}
      <div style={{ marginTop: 12, padding: "12px 14px", background: PALETTE.primaryLight, borderRadius: 10 }}>
        <Row label="Giá bán / khách" value={formatVND(pricing.sellPerPaxRounded)} big />
        <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 4 }}>
          {formatVND(pricing.sellPerPaxRounded)} × {pricing.pax} khách = {formatVND(pricing.sellSubtotal)}
        </div>
      </div>

      {/* Phụ thu tự chọn — SAU giá bán/khách */}
      <div style={{ marginTop: 10, border: `1px dashed ${PALETTE.borderStrong}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", background: PALETTE.surfaceAlt }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: PALETTE.ink }}>+ Phụ thu tự chọn</span>
          <button className="ta-btn ta-btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={addSurcharge}>
            <Plus size={11} /> Thêm
          </button>
        </div>

        {(tour.surcharges || []).length === 0 ? (
          <div style={{ fontSize: 11, color: PALETTE.textFaint, fontStyle: "italic", padding: "8px 14px" }}>
            VD: phụ thu phòng đơn, phụ thu cao điểm lễ...
          </div>
        ) : (
          <div style={{ padding: "6px 14px 10px" }}>
            {/* Header cột */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 88px 20px", gap: 5, marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: PALETTE.textFaint, fontWeight: 700 }}>DIỄN GIẢI</span>
              <span style={{ fontSize: 10, color: PALETTE.textFaint, fontWeight: 700, textAlign: "right" }}>SL</span>
              <span style={{ fontSize: 10, color: PALETTE.textFaint, fontWeight: 700, textAlign: "right" }}>TỔNG CỘNG</span>
              <span />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {(tour.surcharges || []).map((s) => {
                const rowTotal = (Number(s.qty) || 1) * (Number(s.amount) || 0);
                return (
                  <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 40px 88px 20px", gap: 5, alignItems: "center" }}>
                    <input className="ta-input" placeholder="Diễn giải" value={s.name}
                      onChange={(e) => updateSurcharge(s.id, { name: e.target.value })}
                      style={{ padding: "5px 7px", fontSize: 12 }} />
                    <input className="ta-input" type="number" min={1} value={s.qty ?? 1}
                      onChange={(e) => updateSurcharge(s.id, { qty: parseNum(e.target.value) })}
                      style={{ padding: "5px 5px", fontSize: 12, textAlign: "right" }} />
                    <input className="ta-input" inputMode="numeric" placeholder="Đơn giá"
                      value={s.amount ? Number(s.amount).toLocaleString("en-US") : ""}
                      onChange={(e) => updateSurcharge(s.id, { amount: parseNum(e.target.value) })}
                      style={{ padding: "5px 7px", fontSize: 12, textAlign: "right" }} />
                    <button onClick={() => removeSurcharge(s.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: PALETTE.textFaint }}>
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>

            {pricing.surchargeTotalAll > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${PALETTE.border}`, display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ color: PALETTE.textMuted }}>Tổng phụ thu</span>
                <span style={{ color: PALETTE.accent }}>{formatVND(pricing.surchargeTotalAll)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tổng giá trị hợp đồng = Giá bán × SL khách + Phụ thu */}
      <div style={{ marginTop: 10, padding: "13px 14px", background: PALETTE.primary, borderRadius: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>TỔNG GIÁ TRỊ HỢP ĐỒNG</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "white" }}>{formatVND(pricing.sellTotal)}</span>
        </div>
        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)", marginTop: 5, lineHeight: 1.6 }}>
          Giá bán {formatVND(pricing.sellPerPaxRounded)} × {pricing.pax} khách = {formatVND(pricing.sellSubtotal)}
          {pricing.surchargeTotalAll > 0 && ` + Phụ thu ${formatVND(pricing.surchargeTotalAll)}`}
        </div>
      </div>

      {/* Lợi nhuận */}
      <div style={{ marginTop: 8, padding: "10px 14px", background: pricing.profitTotal >= 0 ? PALETTE.accentLight : PALETTE.dangerLight, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: pricing.profitTotal >= 0 ? PALETTE.accent : PALETTE.danger, display: "flex", alignItems: "center", gap: 5 }}>
          <TrendingUp size={14} /> Lợi nhuận dự kiến
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: pricing.profitTotal >= 0 ? PALETTE.accent : PALETTE.danger }}>
          {formatVND(pricing.profitTotal)}
        </span>
      </div>

      <button className="ta-btn ta-btn-primary" onClick={onPreview} style={{ width: "100%", justifyContent: "center", marginTop: 14, padding: "11px" }}>
        <Eye size={16} /> Xem & in báo giá
      </button>
    </div>
  );
}


function Row({ label, value, muted, big, small }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: small ? 12 : 13, color: muted ? PALETTE.textMuted : PALETTE.ink }}>{label}</span>
      <span style={{ fontSize: big ? 22 : small ? 12.5 : 14, fontWeight: big ? 700 : 600, color: big ? PALETTE.primaryDark : muted ? PALETTE.textMuted : PALETTE.ink, fontFamily: big ? "'Montserrat', sans-serif" : "'Montserrat', sans-serif" }}>
        {value}
      </span>
    </div>
  );
}

/* ============================================================
   QUOTE PREVIEW / PRINT
   ============================================================ */

function StopCard({ stop, onUpdate, onRemove }) {
  return (
    <div style={{ position:"relative", borderRadius:10, overflow:"hidden", border:`1px solid ${PALETTE.border}` }}>
      <div style={{ height:90, background: stop.imageUrl ? `url(${stop.imageUrl}) center/cover` : PALETTE.surfaceAlt, display:"flex", alignItems:"center", justifyContent:"center" }}>
        {!stop.imageUrl && <Camera size={18} color={PALETTE.textFaint}/>}
      </div>
      <div style={{ padding:"8px 10px", display:"flex", flexDirection:"column", gap:4 }}>
        <input className="ta-input" placeholder="Tên điểm" value={stop.name} onChange={(e)=>onUpdate({name:e.target.value})} style={{ padding:"5px 8px", fontSize:12.5, fontWeight:600 }}/>
        <input className="ta-input" placeholder="URL ảnh" value={stop.imageUrl} onChange={(e)=>onUpdate({imageUrl:e.target.value})} style={{ padding:"5px 8px", fontSize:11 }}/>
      </div>
      <button onClick={onRemove} style={{ position:"absolute", top:6, right:6, background:"rgba(0,0,0,0.5)", border:"none", borderRadius:"50%", width:22, height:22, cursor:"pointer", color:"white", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <X size={12}/>
      </button>
    </div>
  );
}

/* ============================================================
   QUOTE PREVIEW / PRINT
   ============================================================ */

function QuotePreview({ tour, onBack }) {
  const [mode, setMode] = useState("client");
  const [shareLink, setShareLink] = useState(null);
  const [shareLinkType, setShareLinkType] = useState(null); // "client" | "approval"
  const [sharing, setSharing] = useState(null); // null | "client" | "approval"
  const [approvalPassword, setApprovalPassword] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const pricing = tourPricing(tour);
  const handlePrint = () => window.print();

  const handleShareClient = async () => {
    setSharing("client");
    try {
      const encoded = await publishTour(tour);
      if (encoded) {
        const url = `${window.location.origin}${window.location.pathname}#/view/${encoded}`;
        setShareLink(url);
        setShareLinkType("client");
        await navigator.clipboard.writeText(url).catch(() => {});
      }
    } catch (e) { console.error(e); }
    setSharing(null);
  };

  const handleShareApproval = async () => {
    if (!approvalPassword.trim()) return;
    setSharing("approval");
    try {
      const encoded = await publishTourApproval(tour, approvalPassword.trim());
      if (encoded) {
        const url = `${window.location.origin}${window.location.pathname}#/approve/${encoded}`;
        setShareLink(url);
        setShareLinkType("approval");
        await navigator.clipboard.writeText(url).catch(() => {});
      }
    } catch (e) { console.error(e); }
    setSharing(null);
    setShowPasswordInput(false);
  };

  return (
    <div>
      <div className="no-print" style={{ position:"sticky", top:0, zIndex:10, background:"rgba(250,248,243,0.95)", backdropFilter:"blur(6px)", borderBottom:`1px solid ${PALETTE.border}` }}>
        <div style={{ maxWidth:900, margin:"0 auto", padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
          <button className="ta-btn ta-btn-ghost" onClick={onBack}><ArrowLeft size={16}/> Quay lại chỉnh sửa</button>
          <div style={{ display:"flex", gap:6, background:PALETTE.surfaceAlt, padding:4, borderRadius:10 }}>
            <button onClick={()=>setMode("client")} className="ta-btn" style={{ background:mode==="client"?PALETTE.surface:"transparent", border:"none", boxShadow:mode==="client"?"0 1px 2px rgba(0,0,0,0.06)":"none", color:mode==="client"?PALETTE.ink:PALETTE.textMuted }}>
              <FileText size={15}/> Lịch trình (gửi khách)
            </button>
            <button onClick={()=>setMode("internal")} className="ta-btn" style={{ background:mode==="internal"?PALETTE.surface:"transparent", border:"none", boxShadow:mode==="internal"?"0 1px 2px rgba(0,0,0,0.06)":"none", color:mode==="internal"?PALETTE.ink:PALETTE.textMuted }}>
              <Wallet size={15}/> Bảng chiết tính
            </button>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button className="ta-btn ta-btn-ghost" onClick={handleShareClient} disabled={sharing === "client"}
              style={{ borderColor: PALETTE.primary, color: PALETTE.primary }}>
              <Share2 size={15}/> {sharing === "client" ? "Đang tạo..." : "Link gửi khách"}
            </button>
            <button className="ta-btn ta-btn-ghost"
              onClick={() => { setShowPasswordInput(!showPasswordInput); setShareLink(null); }}
              style={{ borderColor: PALETTE.accent, color: PALETTE.accent }}>
              <Lock size={15}/> Link gửi Sếp duyệt
            </button>
            <button className="ta-btn ta-btn-primary" onClick={handlePrint}><Printer size={16}/> In / PDF</button>
          </div>
        </div>

        {/* Form nhập password cho link Sếp */}
        {showPasswordInput && (
          <div style={{ maxWidth:900, margin:"0 auto", padding:"0 24px 14px" }}>
            <div style={{ padding:"14px 16px", background: PALETTE.accentLight, borderRadius:10, border:`1px solid ${PALETTE.accent}` }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:PALETTE.accent, marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                <Lock size={14}/> Tạo link gửi Sếp — bảo vệ bằng mật khẩu
              </div>
              <div style={{ fontSize:11.5, color:PALETTE.textMuted, marginBottom:10, lineHeight:1.6 }}>
                Sếp sẽ thấy <strong>bảng chiết tính đầy đủ</strong> (giá vốn, lợi nhuận, phụ thu). Nhập mật khẩu để bảo vệ link — chỉ ai có mật khẩu mới mở được.
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <input
                  className="ta-input"
                  type="password"
                  placeholder="Nhập mật khẩu (VD: sep123)"
                  value={approvalPassword}
                  onChange={(e) => setApprovalPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleShareApproval()}
                  style={{ flex:1, padding:"8px 12px", fontSize:13 }}
                  autoFocus
                />
                <button className="ta-btn"
                  onClick={handleShareApproval}
                  disabled={!approvalPassword.trim() || sharing === "approval"}
                  style={{ background: PALETTE.accent, color:"white", padding:"8px 16px", flexShrink:0 }}>
                  {sharing === "approval" ? "Đang tạo..." : "Tạo link"}
                </button>
                <button onClick={() => { setShowPasswordInput(false); setApprovalPassword(""); }}
                  style={{ background:"none", border:"none", cursor:"pointer", color:PALETTE.textFaint }}>
                  <X size={16}/>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Share link banner */}
        {shareLink && (
          <div style={{ maxWidth:900, margin:"0 auto", padding:"0 24px 12px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", borderRadius:10,
              background: shareLinkType === "approval" ? PALETTE.accentLight : PALETTE.primaryLight,
              border: `1px solid ${shareLinkType === "approval" ? PALETTE.accent : PALETTE.primary}` }}>
              <Lock size={14} color={shareLinkType === "approval" ? PALETTE.accent : PALETTE.primary}/>
              <input readOnly value={shareLink} style={{ flex:1, border:"none", background:"transparent", fontSize:12, color: shareLinkType === "approval" ? PALETTE.accent : PALETTE.primaryDark, outline:"none", fontFamily:"'Montserrat',sans-serif" }}/>
              <button className="ta-btn" style={{ padding:"5px 12px", fontSize:12, background: shareLinkType === "approval" ? PALETTE.accent : PALETTE.primary, color:"white", flexShrink:0 }}
                onClick={() => navigator.clipboard.writeText(shareLink).catch(()=>{})}>
                Copy
              </button>
              <button onClick={() => setShareLink(null)} style={{ background:"none", border:"none", cursor:"pointer", color:PALETTE.textFaint }}>
                <X size={14}/>
              </button>
            </div>
            <div style={{ fontSize:11, color:PALETTE.textMuted, marginTop:5, paddingLeft:2 }}>
              {shareLinkType === "approval"
                ? `🔐 Link Sếp duyệt — cần nhập đúng mật khẩu để xem bảng chiết tính đầy đủ`
                : `✓ Link gửi khách — khách thấy lịch trình và giá bán, không thấy giá vốn`}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding:"32px 24px 80px" }}>
        <div id="print-area" style={{ maxWidth:794, margin:"0 auto" }}>
          {mode==="client" ? (
            <ClientItineraryDoc tour={tour} pricing={pricing} currency="USD" exchangeRate={1}/>
          ) : (
            <CostBreakdownDoc tour={tour} pricing={pricing} currency="USD" exchangeRate={1}/>
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

function ClientItineraryDoc({ tour, pricing, currency = "USD", exchangeRate = 1 }) {
  const money = (n) => formatMoney(n);
  const company = tour.company || {};
  const itinerary = tour.itinerary || [];
  return (
    <DocShell noPadding>
      {tour.coverImageUrl && (
        <div style={{ height: 220, background: `url(${tour.coverImageUrl}) center/cover` }} />
      )}
      <div style={{ padding: "40px 52px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: `2px solid ${PALETTE.primary}` }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: PALETTE.primaryDark, fontFamily: "'Montserrat', sans-serif" }}>{company.name}</div>
            <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 4, lineHeight: 1.6 }}>
              {company.address && <div>{company.address}</div>}
              <div>{company.phone}{company.email ? ` · ${company.email}` : ""}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", color: PALETTE.textFaint, textTransform: "uppercase" }}>Chương trình tour</div>
            {tour.startDate && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 4 }}>Khởi hành: {tour.startDate}</div>}
          </div>
        </div>

        <h1 style={{ fontFamily:"'Montserrat',sans-serif", fontSize:26, fontWeight:800, margin:"0 0 8px", color:PALETTE.ink }}>
          {tour.name || "Chương trình tour"}
        </h1>
        <div style={{ display:"flex", gap:18, fontSize:13, color:PALETTE.textMuted, marginBottom:24 }}>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}><MapPin size={14}/> {tour.destination||"—"}</span>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}><Calendar size={14}/> {tour.durationDays} ngày {tour.durationDays>1?`${tour.durationDays-1} đêm`:""}</span>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}><Users size={14}/> {pricing.pax} khách</span>
        </div>

        {/* Điểm nổi bật */}
        {tour.highlights && (
          <div style={{ marginBottom:24, padding:"16px 20px", background:PALETTE.primaryLight, borderRadius:12, borderLeft:`4px solid ${PALETTE.primary}` }}>
            <div style={{ fontSize:12, fontWeight:800, letterSpacing:"0.06em", color:PALETTE.primaryDark, marginBottom:8, textTransform:"uppercase" }}>✦ Điểm nổi bật</div>
            <div style={{ fontSize:13, lineHeight:1.8, color:PALETTE.ink }} dangerouslySetInnerHTML={{ __html: tour.highlights }}/>
          </div>
        )}

        {/* Tour bao gồm / không bao gồm */}
        {((tour.includes||[]).length > 0 || (tour.excludes||[]).length > 0) && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:24 }}>
            {(tour.includes||[]).length > 0 && (
              <div style={{ padding:"14px 16px", background:"#F0FAF6", borderRadius:10, border:`1px solid ${PALETTE.primaryLight}` }}>
                <div style={{ fontSize:12, fontWeight:800, color:PALETTE.primary, marginBottom:8, textTransform:"uppercase" }}>✓ Tour bao gồm</div>
                <ul style={{ margin:0, padding:"0 0 0 16px", fontSize:12.5, lineHeight:1.8, color:PALETTE.ink }}>
                  {(tour.includes||[]).map((item,i)=> item && <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}
            {(tour.excludes||[]).length > 0 && (
              <div style={{ padding:"14px 16px", background:"#FDF4F3", borderRadius:10, border:`1px solid ${PALETTE.dangerLight}` }}>
                <div style={{ fontSize:12, fontWeight:800, color:PALETTE.danger, marginBottom:8, textTransform:"uppercase" }}>✗ Không bao gồm</div>
                <ul style={{ margin:0, padding:"0 0 0 16px", fontSize:12.5, lineHeight:1.8, color:PALETTE.ink }}>
                  {(tour.excludes||[]).map((item,i)=> item && <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {itinerary.map((day) => (
            <div key={day.id} style={{ pageBreakInside: "avoid", borderRadius: 12, overflow: "hidden", border: `1px solid ${PALETTE.border}` }}>
              {/* Header ngày — đúng kiểu RootTrip */}
              <div style={{ display: "flex", alignItems: "stretch", background: PALETTE.primary }}>
                <div style={{
                  minWidth: 56, display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", padding: "10px 0", background: PALETTE.primaryDark, color: "white",
                }}>
                  <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.08em", opacity: 0.7 }}>NGÀY</span>
                  <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Montserrat', sans-serif", lineHeight: 1 }}>{day.dayNumber}</span>
                </div>
                <div style={{ flex: 1, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "white", lineHeight: 1.4 }}>
                    {day.title || `Ngày ${day.dayNumber}`}
                  </div>
                  {day.meals && day.meals.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {day.meals.map((meal) => (
                        <span key={meal} style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: "rgba(255,255,255,0.2)", color: "white" }}>
                          Ăn {meal.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Nội dung HTML từ rich text */}
              <div style={{ padding: "14px 18px" }}>
                {/* Lưới ảnh điểm tham quan — TRÊN ĐẦU */}
                {day.stops.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
                    {day.stops.map((stop) => (
                      <div key={stop.id} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${PALETTE.border}` }}>
                        <div style={{ height: 90, background: stop.imageUrl ? `url(${stop.imageUrl}) center/cover` : PALETTE.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {!stop.imageUrl && <ImageIcon size={16} color={PALETTE.textFaint} />}
                        </div>
                        {stop.name && (
                          <div style={{ padding: "5px 8px", fontSize: 11, fontWeight: 600, color: PALETTE.ink }}>{stop.name}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Nội dung lịch trình — DƯỚI ảnh */}
                {(day.content || day.summary) ? (
                  <div
                    style={{ fontSize: 13, lineHeight: 1.8, color: PALETTE.ink }}
                    dangerouslySetInnerHTML={{ __html: day.content || `<p>${day.summary}</p>` }}
                  />
                ) : (
                  <div style={{ fontSize: 12.5, color: PALETTE.textFaint, fontStyle: "italic" }}>Chưa có nội dung lịch trình</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, padding: "20px 24px", background: PALETTE.primaryLight, borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12.5, color: PALETTE.primaryDark, fontWeight: 600 }}>Giá tour trọn gói</div>
            <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 2 }}>{money(pricing.sellPerPaxRounded)} / khách × {pricing.pax} khách</div>
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: PALETTE.primaryDark, fontFamily: "'Montserrat', sans-serif" }}>{money(pricing.sellTotal)}</div>
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: PALETTE.textFaint, lineHeight: 1.6 }}>
          Báo giá có giá trị tham khảo, có thể thay đổi tuỳ thời điểm và số lượng khách thực tế. Vui lòng liên hệ để được tư vấn và xác nhận chi tiết.
        </div>

        <AgentBlock tour={tour} />
      </div>
    </DocShell>
  );
}



/* ---------- Thông tin người báo giá — dùng chung trong cả 2 bản in ---------- */
function AgentBlock({ tour }) {
  const agent = tour?.agent || {};
  const company = tour?.company || {};
  const hasAgent = agent.name || agent.phone || agent.email;
  if (!hasAgent && !company.name) return null;

  return (
    <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {/* Thông tin công ty */}
      <div style={{ padding: "14px 16px", background: PALETTE.primaryLight, borderRadius: 10 }}>
        {company.logo && (
          <img src={company.logo} alt="logo" style={{ height: 36, objectFit: "contain", marginBottom: 8, display: "block" }} onError={(e) => { e.target.style.display = "none"; }} />
        )}
        <div style={{ fontSize: 13, fontWeight: 700, color: PALETTE.primaryDark }}>{company.name}</div>
        {company.address && <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 3 }}>📍 {company.address}</div>}
        {company.phone && <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 2 }}>📞 {company.phone}</div>}
        {company.email && <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 2 }}>✉ {company.email}</div>}
        {company.website && <div style={{ fontSize: 11.5, color: PALETTE.primary, marginTop: 2 }}>🌐 {company.website}</div>}
      </div>

      {/* Thông tin người báo giá */}
      {hasAgent && (
        <div style={{ padding: "14px 16px", background: PALETTE.accentLight, borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: PALETTE.accent, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Người báo giá</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: PALETTE.ink }}>{agent.name}</div>
          {agent.title && <div style={{ fontSize: 11.5, color: PALETTE.textMuted, marginTop: 2 }}>{agent.title}</div>}
          {agent.phone && <div style={{ fontSize: 12, color: PALETTE.ink, marginTop: 4 }}>📞 {agent.phone}</div>}
          {agent.zalo && <div style={{ fontSize: 12, color: PALETTE.ink, marginTop: 2 }}>💬 Zalo: {agent.zalo}</div>}
          {agent.email && <div style={{ fontSize: 12, color: PALETTE.ink, marginTop: 2 }}>✉ {agent.email}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- Internal cost breakdown — TourAI style table ---------- */

function CostBreakdownDoc({ tour, pricing, currency = "USD", exchangeRate = 1 }) {
  const money = (n) => formatMoney(n);
  const costCategories = tour.costCategories || [];
  return (
    <DocShell>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Montserrat', sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>BẢNG CHIẾT TÍNH</h1>
        <div style={{ fontSize: 15, fontWeight: 600, color: PALETTE.primary }}>{tour.name || "Tour chưa đặt tên"}</div>
        <div style={{ fontSize: 12.5, color: PALETTE.textMuted, marginTop: 4 }}>
          {tour.durationDays} ngày {tour.durationDays > 1 ? `${tour.durationDays - 1} đêm` : ""} · {pricing.pax} khách
          {tour.startDate ? ` · Khởi hành ${tour.startDate}` : ""}
          {currency === "USD" && ` · Tỷ giá 1 USD = ${Number(exchangeRate).toLocaleString("vi-VN")} ₫`}
        </div>
      </div>

      <div style={{ border: `1px solid ${PALETTE.border}`, borderRadius: 10, overflow: "hidden" }}>
        {/* Header: STT | Khoản mục | SL | Đêm/Lượt/Bữa | Đơn giá | Tổng CP Tour | Chi phí/khách | Ghi chú */}
        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 38px 70px 80px 95px 90px 55px", background: PALETTE.gold, fontSize: 10, fontWeight: 700, color: "#3D3000" }}>
          <div style={cellHead}>STT</div>
          <div style={cellHead}>KHOẢN MỤC</div>
          <div style={{ ...cellHead, textAlign: "right" }}>SL</div>
          <div style={{ ...cellHead, textAlign: "center" }}>Đêm/Lượt/Bữa</div>
          <div style={{ ...cellHead, textAlign: "right" }}>Đơn giá</div>
          <div style={{ ...cellHead, textAlign: "right" }}>TỔNG CP TOUR</div>
          <div style={{ ...cellHead, textAlign: "right" }}>CP/KHÁCH</div>
          <div style={cellHead}>ĐVT</div>
        </div>

        {costCategories.map((cat, catIdx) => {
          const total = categoryTotal(cat, pricing.pax);
          const totalTourCat = cat.items.reduce((s, item) => s + itemAmounts(item, pricing.pax).totalTourAfterVat, 0);
          return (
            <React.Fragment key={cat.id}>
              <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 38px 70px 80px 95px 90px 55px", background: "#DAEAF7", fontSize: 11.5, fontWeight: 700, borderTop: `1px solid ${PALETTE.border}` }}>
                <div style={cell}>{String.fromCharCode(64 + catIdx + 1)}</div>
                <div style={cell}>{cat.name}</div>
                <div style={cell}></div><div style={cell}></div><div style={cell}></div>
                <div style={{ ...cell, textAlign: "right", color: PALETTE.danger }}>{money(totalTourCat)}</div>
                <div style={{ ...cell, textAlign: "right", color: PALETTE.primaryDark }}>{money(total)}</div>
                <div style={cell}></div>
              </div>
              {cat.items.map((item, itemIdx) => {
                const a = itemAmounts(item, pricing.pax);
                return (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr 38px 70px 80px 95px 90px 55px", fontSize: 11, borderTop: `1px solid ${PALETTE.border}` }}>
                    <div style={{ ...cell, color: PALETTE.textFaint }}>{itemIdx + 1}</div>
                    <div style={cell}>{item.name || "—"}</div>
                    <div style={{ ...cell, textAlign: "right" }}>{item.qty}</div>
                    <div style={{ ...cell, textAlign: "right" }}>{item.sessions ?? 1}</div>
                    <div style={{ ...cell, textAlign: "right", color: PALETTE.textMuted }}>{item.unitCost ? money(item.unitCost) : "-"}</div>
                    <div style={{ ...cell, textAlign: "right", fontWeight: 600, color: PALETTE.danger }}>{money(a.totalTourAfterVat)}</div>
                    <div style={{ ...cell, textAlign: "right", fontWeight: 600, color: PALETTE.primaryDark }}>{money(a.afterVat)}</div>
                    <div style={{ ...cell, fontSize: 10, color: PALETTE.textFaint }}>{item.unit}</div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}

        {/* Dòng TỔNG */}
        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 38px 70px 80px 95px 90px 55px", background: "#FFF3CD", fontWeight: 700, fontSize: 11.5, borderTop: `2px solid ${PALETTE.borderStrong}` }}>
          <div style={cell}>H</div>
          <div style={{ ...cell, color: PALETTE.danger }}>TỔNG</div>
          <div style={cell}></div><div style={cell}></div><div style={cell}></div>
          <div style={{ ...cell, textAlign: "right", color: PALETTE.danger }}>{money(pricing.costTotalAll)}</div>
          <div style={{ ...cell, textAlign: "right", color: PALETTE.primaryDark }}>{money(pricing.costPerPax)}</div>
          <div style={cell}></div>
        </div>
      </div>

      {/* Summary block */}
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 0, border: `1px solid ${PALETTE.border}`, borderRadius: 10, overflow: "hidden" }}>
        <SummaryLine label="Chi phí / khách" value={money(pricing.costPerPax)} />
        <SummaryLine label="Lợi nhuận / khách" value={money(pricing.profitPerPax)} />
        {pricing.surchargePerPax > 0 && (
          <SummaryLine label={`Phụ thu / khách (${(tour.surcharges||[]).map(s=>s.name).filter(Boolean).join(", ")})`} value={money(pricing.surchargePerPax)} />
        )}
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

      <AgentBlock tour={tour} />

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
      <span style={{ fontSize: big ? 18 : 13.5, fontWeight: bold ? 700 : 600, color, fontFamily: big ? "'Montserrat', sans-serif" : "'Montserrat', sans-serif" }}>{value}</span>
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

/* ============================================================
   APPROVAL PASSWORD GATE — màn nhập password xem bảng chiết tính
   ============================================================ */

function ApprovalPasswordGate({ payload }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tour, setTour] = useState(null);

  const handleSubmit = async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    const result = await loadApprovalTour(payload, password.trim());
    setLoading(false);
    if (result.error === "wrong_password") {
      setError("Mật khẩu không đúng. Vui lòng thử lại.");
    } else if (result.error) {
      setError("Link không hợp lệ hoặc đã hết hạn.");
    } else {
      setTour(result.tour);
    }
  };

  // Sau khi unlock — hiện bảng chiết tính
  if (tour) {
    const pricing = (() => { try { return tourPricing(tour); } catch { return { sellTotal:0, sellPerPaxRounded:0, pax:1, costTotalAll:0, profitTotal:0, costPerPax:0, sellSubtotal:0, surchargeTotalAll:0 }; } })();
    return (
      <div style={{ minHeight:"100vh", background:PALETTE.bg, fontFamily:"'Montserrat',sans-serif" }}>
        <div style={{ background: PALETTE.accent, padding:"12px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, color:"white" }}>
            <Lock size={16}/>
            <span style={{ fontWeight:700, fontSize:14 }}>Bảng chiết tính — {tour.name || "Tour"}</span>
            <span style={{ fontSize:11, background:"rgba(255,255,255,0.2)", padding:"2px 8px", borderRadius:20 }}>Chế độ phê duyệt</span>
          </div>
          <button className="ta-btn" onClick={() => window.print()}
            style={{ background:"white", color:PALETTE.accent, padding:"6px 14px", fontSize:12 }}>
            <Printer size={13}/> In / PDF
          </button>
        </div>
        <div style={{ maxWidth:860, margin:"0 auto", padding:"32px 24px 80px" }}>
          <CostBreakdownDoc tour={tour} pricing={pricing} currency="USD" exchangeRate={1}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:PALETTE.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Montserrat',sans-serif", padding:24 }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        <div className="ta-card" style={{ padding:"36px 32px" }}>
          {/* Icon + tiêu đề */}
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ width:56, height:56, borderRadius:14, background:PALETTE.accentLight, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
              <Lock size={26} color={PALETTE.accent}/>
            </div>
            <h1 style={{ fontSize:20, fontWeight:800, margin:"0 0 6px", color:PALETTE.ink }}>Phê duyệt báo giá</h1>
            <p style={{ fontSize:13, color:PALETTE.textMuted, margin:0, lineHeight:1.6 }}>
              Bảng chiết tính được bảo vệ.<br/>Nhập mật khẩu để xem nội dung.
            </p>
          </div>

          {/* Input password */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <input
              className="ta-input"
              type="password"
              placeholder="Nhập mật khẩu"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={{ padding:"11px 14px", fontSize:14, textAlign:"center", letterSpacing:"0.1em" }}
              autoFocus
            />
            {error && (
              <div style={{ fontSize:12.5, color:PALETTE.danger, textAlign:"center", padding:"8px 12px", background:PALETTE.dangerLight, borderRadius:8 }}>
                {error}
              </div>
            )}
            <button
              className="ta-btn"
              onClick={handleSubmit}
              disabled={loading || !password.trim()}
              style={{ background:PALETTE.accent, color:"white", justifyContent:"center", padding:"11px", fontSize:14, fontWeight:700 }}>
              {loading ? "Đang kiểm tra..." : "Mở bảng chiết tính"}
            </button>
          </div>

          <p style={{ fontSize:11, color:PALETTE.textFaint, textAlign:"center", marginTop:16, lineHeight:1.5 }}>
            Liên hệ người tạo báo giá để nhận mật khẩu
          </p>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ERROR BOUNDARY — bắt crash khi render public tour
   ============================================================ */

class PublicTourErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#FAF8F3", fontFamily: "'Montserrat',sans-serif", padding: 24 }}>
          <Compass size={40} color="#9CA39D" />
          <p style={{ fontSize: 15, fontWeight: 600, color: "#1C2B28" }}>Không thể hiển thị báo giá</p>
          <p style={{ fontSize: 13, color: "#6B7570", maxWidth: 360, textAlign: "center" }}>
            Link có thể bị hỏng hoặc dữ liệu tour quá lớn. Vui lòng yêu cầu người gửi tạo lại link mới.
          </p>
          <details style={{ fontSize: 11, color: "#9CA39D", maxWidth: 400 }}>
            <summary style={{ cursor: "pointer" }}>Chi tiết lỗi</summary>
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.error?.message}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================================================
   PUBLIC VIEWS — Ticket / Hotel / Car
   ============================================================ */

// Shared topbar cho public views
function PublicTopBar({ color, icon: Icon, title, onPrint }) {
  return (
    <div style={{ background: color, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={17} color="white" />
        </div>
        <span style={{ color: "white", fontWeight: 700, fontSize: 15 }}>{title}</span>
      </div>
      <button className="ta-btn" onClick={onPrint}
        style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "none", padding: "6px 14px", fontSize: 12 }}>
        <Printer size={13} /> In / PDF
      </button>
    </div>
  );
}

function PublicQuoteHeader({ color, label, name, subtitle, coverImageUrl, metaItems }) {
  return (
    <>
      {coverImageUrl && (
        <div style={{ height: 200, borderRadius: 14, overflow: "hidden", marginBottom: 20, background: `url(${coverImageUrl}) center/cover` }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: `${color}18`, color }}>{label}</span>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 6px", color: PALETTE.ink }}>{name || "Báo giá"}</h1>
      {subtitle && <div style={{ fontSize: 14, color: PALETTE.textMuted, marginBottom: 12 }}>{subtitle}</div>}
      {metaItems && (
        <div style={{ display: "flex", gap: 16, fontSize: 13, color: PALETTE.textMuted, marginBottom: 24, flexWrap: "wrap" }}>
          {metaItems.filter(Boolean).map((m, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>{m}</span>
          ))}
        </div>
      )}
    </>
  );
}

/* ---- Báo giá Vé tham quan ---- */
function PublicTicketView({ data: d }) {
  const total = ticketTotal(d);
  const pax = Number(d.pax) || 1;
  return (
    <div style={{ minHeight: "100vh", background: PALETTE.bg, fontFamily: "'Montserrat',sans-serif" }}>
      <PublicTopBar color="#7C3AED" icon={Ticket} title={d.company?.name || "Báo giá Vé tham quan"} onPrint={() => window.print()} />
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "28px 24px 80px" }}>
        <PublicQuoteHeader
          color="#7C3AED" label="BÁO GIÁ VÉ THAM QUAN"
          name={d.name} subtitle={d.destination}
          coverImageUrl={d.coverImageUrl}
          metaItems={[
            d.visitDate && <><Calendar size={14}/> Ngày tham quan: {d.visitDate}</>,
            <><Users size={14}/> {pax} khách</>,
          ]}
        />

        {/* Bảng vé */}
        <div className="ta-card" style={{ overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 80px 60px 110px", gap: 0, background: "#7C3AED", fontSize: 11, fontWeight: 700, color: "white" }}>
            {["", "LOẠI VÉ", "ĐƠN GIÁ", "SL", "THÀNH TIỀN"].map((h, i) => (
              <div key={i} style={{ padding: "9px 12px", textAlign: i >= 2 ? "right" : "left" }}>{h}</div>
            ))}
          </div>
          {(d.items || []).map((ti, idx) => (
            <div key={ti.id || idx} style={{ display: "grid", gridTemplateColumns: "70px 1fr 80px 60px 110px", borderBottom: `1px solid ${PALETTE.border}`, alignItems: "center" }}>
              <div style={{ padding: "10px 12px" }}>
                {ti.imageUrl ? (
                  <img src={ti.imageUrl} alt="" style={{ width: 52, height: 38, objectFit: "cover", borderRadius: 6 }}
                    onError={(e) => { e.target.style.display = "none"; }} />
                ) : (
                  <div style={{ width: 52, height: 38, borderRadius: 6, background: PALETTE.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Ticket size={16} color={PALETTE.textFaint} />
                  </div>
                )}
              </div>
              <div style={{ padding: "10px 12px" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{ti.name || "—"}</div>
                <div style={{ fontSize: 11, color: PALETTE.textMuted, marginTop: 2 }}>{ti.type}</div>
              </div>
              <div style={{ padding: "10px 12px", textAlign: "right", fontSize: 13 }}>{formatVND(ti.unitPrice)}</div>
              <div style={{ padding: "10px 12px", textAlign: "right", fontSize: 13 }}>{ti.qty}</div>
              <div style={{ padding: "10px 12px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#7C3AED" }}>{formatVND((Number(ti.unitPrice)||0)*(Number(ti.qty)||0))}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ padding: "16px 24px", background: "#7C3AED", borderRadius: 12, minWidth: 260, color: "white" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800 }}>
              <span>TỔNG TIỀN VÉ</span><span>{formatVND(total)}</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{formatVND(total / pax)} / khách</div>
          </div>
        </div>

        {d.note && <div style={{ marginTop: 20, padding: "12px 16px", background: PALETTE.surfaceAlt, borderRadius: 10, fontSize: 13, color: PALETTE.textMuted }}>{d.note}</div>}
        <AgentBlock tour={d} />
      </div>
    </div>
  );
}

/* ---- Báo giá Phòng khách sạn ---- */
function PublicHotelView({ data: d }) {
  const subTotal = (d.items||[]).reduce((s,i)=>s+(Number(i.unitPrice)||0)*(Number(i.qty)||0)*(Number(i.nights)||1), 0);
  const tax = d.includeTax ? subTotal * (Number(d.taxPercent)||0)/100 : 0;
  const total = subTotal + tax;
  const pax = Number(d.pax) || 1;

  return (
    <div style={{ minHeight: "100vh", background: PALETTE.bg, fontFamily: "'Montserrat',sans-serif" }}>
      <PublicTopBar color="#0369A1" icon={Building2} title={d.company?.name || "Báo giá Phòng khách sạn"} onPrint={() => window.print()} />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px 80px" }}>
        <PublicQuoteHeader
          color="#0369A1" label="BÁO GIÁ PHÒNG KHÁCH SẠN"
          name={d.name} subtitle={d.hotelName ? `${d.hotelName}${d.location ? ` · ${d.location}` : ""}` : d.location}
          coverImageUrl={d.coverImageUrl}
          metaItems={[
            d.checkIn && <><Calendar size={14}/> Check-in: {d.checkIn}</>,
            d.checkOut && <><Calendar size={14}/> Check-out: {d.checkOut}</>,
            d.nights && <><Clock size={14}/> {d.nights} đêm</>,
            <><Users size={14}/> {pax} khách</>,
          ]}
        />

        {/* Bảng phòng */}
        <div className="ta-card" style={{ overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 70px 50px 50px 110px 60px", background: "#0369A1", fontSize: 10.5, fontWeight: 700, color: "white" }}>
            {["", "LOẠI PHÒNG", "DỊCH VỤ", "SL", "ĐÊM", "ĐƠN GIÁ/ĐÊM", "TỔNG"].map((h, i) => (
              <div key={i} style={{ padding: "9px 10px", textAlign: i >= 2 ? "right" : "left" }}>{h}</div>
            ))}
          </div>
          {(d.items||[]).map((ri, idx) => {
            const lineTotal = (Number(ri.unitPrice)||0)*(Number(ri.qty)||0)*(Number(ri.nights)||1);
            return (
              <div key={ri.id||idx} style={{ display: "grid", gridTemplateColumns: "80px 1fr 70px 50px 50px 110px 60px", borderBottom: `1px solid ${PALETTE.border}`, alignItems: "center" }}>
                <div style={{ padding: "10px 10px" }}>
                  {ri.imageUrl ? (
                    <img src={ri.imageUrl} alt="" style={{ width: 60, height: 44, objectFit: "cover", borderRadius: 6 }}
                      onError={(e) => { e.target.style.display = "none"; }} />
                  ) : (
                    <div style={{ width: 60, height: 44, borderRadius: 6, background: PALETTE.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Building2 size={16} color={PALETTE.textFaint} />
                    </div>
                  )}
                </div>
                <div style={{ padding: "10px 10px" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{ri.roomType || "—"}</div>
                  <div style={{ fontSize: 11, color: "#0369A1", fontWeight: 600, marginTop: 2 }}>{ri.board || "BB"}</div>
                </div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 12 }}>{ri.service || "—"}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13 }}>{ri.qty}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13 }}>{ri.nights || d.nights}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13 }}>{formatVND(ri.unitPrice)}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#0369A1" }}>{formatVND(lineTotal)}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ padding: "16px 24px", background: "#0369A1", borderRadius: 12, minWidth: 280, color: "white" }}>
            {d.includeTax && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                <span>Subtotal</span><span>{formatVND(subTotal)}</span>
              </div>
            )}
            {d.includeTax && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
                <span>Thuế & phí ({d.taxPercent||10}%)</span><span>{formatVND(tax)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, borderTop: "1px solid rgba(255,255,255,0.3)", paddingTop: 8 }}>
              <span>TỔNG CỘNG</span><span>{formatVND(total)}</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{formatVND(total / pax)} / khách</div>
          </div>
        </div>

        {d.note && <div style={{ marginTop: 20, padding: "12px 16px", background: PALETTE.surfaceAlt, borderRadius: 10, fontSize: 13, color: PALETTE.textMuted }}>{d.note}</div>}
        <AgentBlock tour={d} />
      </div>
    </div>
  );
}

/* ---- Báo giá Xe ---- */
function PublicCarView({ data: d }) {
  const total = carTotal(d);
  const pax = Number(d.pax) || 1;
  return (
    <div style={{ minHeight: "100vh", background: PALETTE.bg, fontFamily: "'Montserrat',sans-serif" }}>
      <PublicTopBar color="#B45309" icon={Bus} title={d.company?.name || "Báo giá Xe"} onPrint={() => window.print()} />
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 24px 80px" }}>
        <PublicQuoteHeader
          color="#B45309" label="BÁO GIÁ XE"
          name={d.name}
          subtitle={d.departure && d.destination ? `${d.departure} → ${d.destination}` : (d.departure || d.destination)}
          coverImageUrl={d.coverImageUrl}
          metaItems={[
            d.startDate && <><Calendar size={14}/> {d.startDate}</>,
            d.endDate && d.endDate !== d.startDate && <><Calendar size={14}/> đến {d.endDate}</>,
            <><Users size={14}/> {pax} khách</>,
          ]}
        />

        {/* Bảng xe */}
        <div className="ta-card" style={{ overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1.2fr 1fr 50px 50px 120px 110px", background: "#B45309", fontSize: 10.5, fontWeight: 700, color: "white" }}>
            {["", "LOẠI XE", "TUYẾN ĐƯỜNG", "SL", "NGÀY", "ĐƠN GIÁ/NGÀY", "THÀNH TIỀN"].map((h, i) => (
              <div key={i} style={{ padding: "9px 10px", textAlign: i >= 3 ? "right" : "left" }}>{h}</div>
            ))}
          </div>
          {(d.items||[]).map((ci, idx) => {
            const lineTotal = (Number(ci.unitPrice)||0)*(Number(ci.qty)||0)*(Number(ci.days)||1);
            return (
              <div key={ci.id||idx} style={{ display: "grid", gridTemplateColumns: "80px 1.2fr 1fr 50px 50px 120px 110px", borderBottom: `1px solid ${PALETTE.border}`, alignItems: "center" }}>
                <div style={{ padding: "10px 10px" }}>
                  {ci.imageUrl ? (
                    <img src={ci.imageUrl} alt="" style={{ width: 62, height: 44, objectFit: "cover", borderRadius: 6 }}
                      onError={(e) => { e.target.style.display = "none"; }} />
                  ) : (
                    <div style={{ width: 62, height: 44, borderRadius: 6, background: PALETTE.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Bus size={16} color={PALETTE.textFaint} />
                    </div>
                  )}
                </div>
                <div style={{ padding: "10px 10px", fontWeight: 600, fontSize: 13 }}>{ci.vehicleType || "—"}</div>
                <div style={{ padding: "10px 10px", fontSize: 12.5, color: PALETTE.textMuted }}>{ci.route || "—"}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13 }}>{ci.qty}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13 }}>{ci.days}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13 }}>{formatVND(ci.unitPrice)}</div>
                <div style={{ padding: "10px 10px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "#B45309" }}>{formatVND(lineTotal)}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: PALETTE.textMuted }}>Chi phí / khách: <strong style={{ color: PALETTE.ink }}>{formatVND(total / pax)}</strong></div>
          <div style={{ padding: "16px 24px", background: "#B45309", borderRadius: 12, minWidth: 240, color: "white" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800 }}>
              <span>TỔNG CHI PHÍ XE</span><span>{formatVND(total)}</span>
            </div>
          </div>
        </div>

        {d.note && <div style={{ marginTop: 20, padding: "12px 16px", background: PALETTE.surfaceAlt, borderRadius: 10, fontSize: 13, color: PALETTE.textMuted }}>{d.note}</div>}
        <AgentBlock tour={d} />
      </div>
    </div>
  );
}

/* ============================================================
   PUBLIC TOUR VIEW — trang khách xem qua link
   ============================================================ */

function PublicTourView({ tour }) {
  // Bảo vệ mọi field có thể thiếu (tour từ phiên bản cũ)
  const safeTour = {
    name: "",
    destination: "",
    startDate: "",
    durationDays: 1,
    pax: 1,
    coverImageUrl: "",
    highlights: "",
    includes: [],
    excludes: [],
    profitMode: "percent",
    profitPercent: 0,
    profitFixed: 0,
    roundTo: 0,
    surcharges: [],
    ...tour,
    company:        { name: "", phone: "", email: "", address: "", website: "", logo: "", ...(tour?.company || {}) },
    agent:          { name: "", title: "", phone: "", email: "", zalo: "", ...(tour?.agent || {}) },
    itinerary:      (tour?.itinerary || []).map(day => ({ id: "", dayNumber: 1, title: "", content: "", summary: "", meals: [], stops: [], ...day, stops: day?.stops || [] })),
    costCategories: (tour?.costCategories || []).map(cat => ({ id: "", name: "", items: [], ...cat, items: cat?.items || [] })),
  };

  // Tính giá an toàn — wrap trong try/catch
  let pricing = { sellPerPaxRounded: 0, sellTotal: 0, pax: safeTour.pax };
  try { pricing = tourPricing(safeTour); } catch (_) {}

  const money = (n) => formatMoney(n);

  return (
    <div style={{ minHeight: "100vh", background: PALETTE.bg, fontFamily: "'Montserrat',sans-serif" }}>
      {/* Topbar */}
      <div style={{ background: PALETTE.primary, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: "white", fontWeight: 700, fontSize: 15 }}>
          {safeTour.company.name || "Báo giá tour"}
        </div>
        <button className="ta-btn ta-btn-primary" onClick={() => window.print()} style={{ padding: "6px 14px", fontSize: 12 }}>
          <Printer size={13} /> In / PDF
        </button>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* Cover image */}
        {safeTour.coverImageUrl && (
          <div style={{ height: 240, borderRadius: 16, overflow: "hidden", marginBottom: 24, background: `url(${safeTour.coverImageUrl}) center/cover` }} />
        )}

        {/* Tiêu đề */}
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px", color: PALETTE.ink }}>
          {safeTour.name || "Chương trình tour"}
        </h1>
        <div style={{ display: "flex", gap: 16, fontSize: 13, color: PALETTE.textMuted, marginBottom: 24, flexWrap: "wrap" }}>
          {safeTour.destination && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><MapPin size={14} /> {safeTour.destination}</span>}
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Calendar size={14} /> {safeTour.durationDays} ngày {safeTour.durationDays > 1 ? `${safeTour.durationDays - 1} đêm` : ""}</span>
          {safeTour.startDate && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Calendar size={14} /> Khởi hành: {safeTour.startDate}</span>}
        </div>

        {/* Giá nổi bật */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", background: PALETTE.primary, borderRadius: 14, marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Giá tour / khách</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "white" }}>{money(pricing.sellPerPaxRounded)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>Tổng đoàn ({pricing.pax} khách)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{money(pricing.sellTotal)}</div>
          </div>
        </div>

        {/* Điểm nổi bật */}
        {safeTour.highlights ? (
          <div style={{ marginBottom: 24, padding: "16px 20px", background: PALETTE.primaryLight, borderRadius: 12, borderLeft: `4px solid ${PALETTE.primary}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.06em", color: PALETTE.primaryDark, marginBottom: 8, textTransform: "uppercase" }}>✦ Điểm nổi bật</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.8, color: PALETTE.ink }} dangerouslySetInnerHTML={{ __html: safeTour.highlights }} />
          </div>
        ) : null}

        {/* Tour bao gồm / không bao gồm */}
        {(safeTour.includes.length > 0 || safeTour.excludes.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
            {safeTour.includes.filter(Boolean).length > 0 && (
              <div style={{ padding: "16px 18px", background: "#F0FAF6", borderRadius: 12, border: `1px solid ${PALETTE.primaryLight}` }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: PALETTE.primary, marginBottom: 10, textTransform: "uppercase" }}>✓ Tour bao gồm</div>
                <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 13, lineHeight: 2, color: PALETTE.ink }}>
                  {safeTour.includes.filter(Boolean).map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}
            {safeTour.excludes.filter(Boolean).length > 0 && (
              <div style={{ padding: "16px 18px", background: "#FDF4F3", borderRadius: 12, border: `1px solid ${PALETTE.dangerLight}` }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: PALETTE.danger, marginBottom: 10, textTransform: "uppercase" }}>✗ Không bao gồm</div>
                <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 13, lineHeight: 2, color: PALETTE.ink }}>
                  {safeTour.excludes.filter(Boolean).map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Lịch trình */}
        {safeTour.itinerary.length > 0 && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 14px", color: PALETTE.ink }}>Lịch trình chi tiết</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {safeTour.itinerary.map((day, idx) => (
                <div key={day.id || idx} style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${PALETTE.border}` }}>
                  {/* Header ngày */}
                  <div style={{ display: "flex", alignItems: "stretch", background: PALETTE.primary }}>
                    <div style={{ minWidth: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 0", background: PALETTE.primaryDark, color: "white" }}>
                      <span style={{ fontSize: 8, fontWeight: 600, opacity: 0.7, letterSpacing: "0.08em" }}>NGÀY</span>
                      <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{day.dayNumber || idx + 1}</span>
                    </div>
                    <div style={{ flex: 1, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>{day.title || `Ngày ${day.dayNumber || idx + 1}`}</div>
                      {day.meals && day.meals.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          {day.meals.map((meal) => (
                            <span key={meal} style={{ padding: "2px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: "rgba(255,255,255,0.2)", color: "white" }}>
                              Ăn {meal.toLowerCase()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Nội dung ngày */}
                  <div style={{ padding: "16px 20px" }}>
                    {(day.content || day.summary) ? (
                      <div style={{ fontSize: 13.5, lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: day.content || `<p>${day.summary}</p>` }} />
                    ) : (
                      <div style={{ fontSize: 12.5, color: PALETTE.textFaint, fontStyle: "italic" }}>Chưa có nội dung</div>
                    )}

                    {/* Ảnh điểm tham quan */}
                    {day.stops.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 8, marginTop: 14 }}>
                        {day.stops.map((stop, si) => (
                          <div key={stop.id || si} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${PALETTE.border}` }}>
                            {stop.imageUrl
                              ? <div style={{ height: 80, background: `url(${stop.imageUrl}) center/cover` }} />
                              : <div style={{ height: 80, background: PALETTE.surfaceAlt }} />
                            }
                            {stop.name && <div style={{ padding: "6px 8px", fontSize: 11.5, fontWeight: 600 }}>{stop.name}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Thông tin công ty & người báo giá */}
        <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: safeTour.agent.name ? "1fr 1fr" : "1fr", gap: 12 }}>
          <div style={{ padding: "16px 18px", background: PALETTE.primaryLight, borderRadius: 12 }}>
            {safeTour.company.logo && (
              <img src={safeTour.company.logo} alt="logo" style={{ height: 32, objectFit: "contain", marginBottom: 8, display: "block" }}
                onError={(e) => { e.target.style.display = "none"; }} />
            )}
            <div style={{ fontWeight: 700, fontSize: 14, color: PALETTE.primaryDark }}>{safeTour.company.name}</div>
            {safeTour.company.address && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 3 }}>📍 {safeTour.company.address}</div>}
            {safeTour.company.phone && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 2 }}>📞 {safeTour.company.phone}</div>}
            {safeTour.company.email && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 2 }}>✉ {safeTour.company.email}</div>}
            {safeTour.company.website && <div style={{ fontSize: 12, color: PALETTE.primary, marginTop: 2 }}>🌐 {safeTour.company.website}</div>}
          </div>
          {safeTour.agent.name && (
            <div style={{ padding: "16px 18px", background: PALETTE.accentLight, borderRadius: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: PALETTE.accent, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Người báo giá</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: PALETTE.ink }}>{safeTour.agent.name}</div>
              {safeTour.agent.title && <div style={{ fontSize: 12, color: PALETTE.textMuted, marginTop: 2 }}>{safeTour.agent.title}</div>}
              {safeTour.agent.phone && <div style={{ fontSize: 12, color: PALETTE.ink, marginTop: 4 }}>📞 {safeTour.agent.phone}</div>}
              {safeTour.agent.zalo && <div style={{ fontSize: 12, color: PALETTE.ink, marginTop: 2 }}>💬 Zalo: {safeTour.agent.zalo}</div>}
              {safeTour.agent.email && <div style={{ fontSize: 12, color: PALETTE.ink, marginTop: 2 }}>✉ {safeTour.agent.email}</div>}
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: PALETTE.textFaint, textAlign: "center" }}>
          Báo giá có giá trị tham khảo. Vui lòng liên hệ để xác nhận và đặt tour.
        </div>
      </div>
    </div>
  );
}

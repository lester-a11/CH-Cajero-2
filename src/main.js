import './styles.css';
import { initDatabase, query, one, run, execute, audit, transaction } from './app/db.js';
import { hashPin, verifyPin } from './app/security.js';
import { calculateCartTotal } from './app/cart.js';
import { roundMoney, formatUSD, formatCUP, recommendedAmount, cashChange, calculateDrawerBalances } from './app/money.js';
import { summarizeSale, buildPaymentRecord, buildChangeRecord, stockToRestore, stockToDeduct } from './app/sale-rules.js';
import { signPayload, verifyPayload, canonicalJSON, createZip, readZip, zipText } from './app/integrity.js';
import { onBarcode, setScannerEnabled, getScannerStatus, installBrowserScanner } from './app/scanner.js';
import { pickArchive, takeProductPhoto, base64ToBytes, saveAndShare, shareExistingZip } from './app/platform.js';
import { buildCatalogImportPlan, buildSingleProductImportPlan, applyableRows } from './app/catalog-import.js';
import { validateBackupPayload, normalizeBackupData, BACKUP_TABLE_COLUMNS } from './app/backup-validation.js';
import { summarizeDayClosure } from './app/closure.js';
import { selectInventoryRecountRows, recountResult, recountProgressLabel } from './app/inventory-count.js';
import { strToU8, strFromU8 } from 'fflate';

const root = document.querySelector('#app');
let scannerStatusTimer = null;
const state = {
  user: null, day: null, turn: null, sale: null, view: 'caja', pendingLoginUser: null,
  product: null, productQty: 1, pendingCode: '',
  paymentMethod: 'USD', paymentValue: '', changeCurrency: 'USD',
  photoBase64: '', currentDetail: null, busyActions: new Set(),
  pendingImport: null, pendingRestore: null
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const id = () => crypto.randomUUID();
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const localTime = value => new Date(value).toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });
const localDateTime = () => new Date().toISOString();
const getConfig = async key => (await one('SELECT valor FROM config WHERE clave=?', [key]))?.valor ?? null;
const setConfig = async (key, value) => run('INSERT OR REPLACE INTO config(clave,valor) VALUES(?,?)', [key, String(value)]);
const moneyInput = value => Number(String(value).replace(',', '.'));

async function runExclusive(key, work) {
  if (state.busyActions.has(key)) return;
  state.busyActions.add(key);
  try { return await work(); }
  finally { state.busyActions.delete(key); }
}

function notify(message, type = 'info') {
  let box = document.querySelector('#toast');
  if (!box) {
    box = document.createElement('div'); box.id = 'toast'; document.body.append(box);
  }
  box.className = `toast ${type}`;
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => box.classList.remove('show'), 3200);
}

function beep() {
  try {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(); oscillator.stop(audio.currentTime + 0.07);
    oscillator.onended = () => audio.close();
  } catch { /* sonido opcional según permisos del dispositivo */ }
  try { navigator.vibrate?.(35); } catch { /* vibración opcional */ }
}

async function start() {
  try {
    await initDatabase();
    onBarcode(code => handleBarcode(code));
    installBrowserScanner(code => handleBarcode(code));
    const users = await query('SELECT * FROM usuarios WHERE activo=1 ORDER BY CASE rol WHEN \'administrador\' THEN 0 ELSE 1 END, nombre');
    if (!users.length) renderFirstSetup();
    else renderLogin(users);
  } catch (error) {
    root.innerHTML = `<main class="fatal"><div class="brand-mark">CH</div><h1>CH Cajero</h1><p>${esc(error.message)}</p><p class="muted">Esta aplicación funciona como APK Android. Instala el paquete generado por GitHub Actions para utilizar SQLite y la pistola USB OTG.</p></main>`;
  }
}

function renderFirstSetup() {
  setScannerEnabled(false);
  root.innerHTML = `
    <main class="auth-page setup-page">
      <img class="welcome-logo" src="/logo_ch.png" alt="CH">
      <h1>Cajero</h1><p class="muted">Configuración inicial del dispositivo.</p>
      <form id="setup-form" class="panel form-grid">
        <label>Nombre de la tienda<input name="store" required maxlength="80" value="CH Electronic / Componentes Habana"></label>
        <div class="separator">Administrador</div>
        <label>Nombre del administrador<input name="adminName" required maxlength="60" autocomplete="name"></label>
        <label>PIN del administrador<input name="adminPin" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required></label>
        <div class="separator">Dependiente 1</div>
        <label>Nombre<input name="cashier1Name" required maxlength="60"></label>
        <label>PIN<input name="cashier1Pin" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required></label>
        <div class="separator">Dependiente 2</div>
        <label>Nombre<input name="cashier2Name" required maxlength="60"></label>
        <label>PIN<input name="cashier2Pin" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required></label>
        <button class="btn primary wide" type="submit">Guardar configuración</button>
      </form>
      <p class="footnote">Los tres PIN deben ser diferentes. Se almacenan protegidos mediante PBKDF2.</p>
    </main>`;
  document.querySelector('#setup-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const people = [
      { name: String(form.get('adminName')).trim(), pin: String(form.get('adminPin')), role: 'administrador' },
      { name: String(form.get('cashier1Name')).trim(), pin: String(form.get('cashier1Pin')), role: 'dependiente' },
      { name: String(form.get('cashier2Name')).trim(), pin: String(form.get('cashier2Pin')), role: 'dependiente' }
    ];
    if (people.some(person => !person.name || !/^\d{4,8}$/.test(person.pin))) return notify('Completa los nombres y PIN válidos.', 'error');
    if (new Set(people.map(person => person.pin)).size !== 3) return notify('Los PIN del administrador y de los dos dependientes deben ser diferentes.', 'error');
    try {
      await transaction(async () => {
        for (const person of people) {
          await run('INSERT INTO usuarios(id,nombre,pin_hash,rol,activo,creado_en) VALUES(?,?,?,?,1,?)',
            [id(), person.name, await hashPin(person.pin), person.role, localDateTime()]);
        }
        await setConfig('nombre_tienda', String(form.get('store')).trim());
        await setConfig('id_dispositivo', `CH-${id().slice(0,8).toUpperCase()}`);
        await setConfig('recargo_transferencia', '20');
      });
      await audit({ nombre: 'Sistema' }, 'configuracion_inicial', 'Se crearon el administrador y los dos dependientes.');
      renderLogin(await query("SELECT * FROM usuarios WHERE activo=1 ORDER BY CASE rol WHEN 'administrador' THEN 0 ELSE 1 END, creado_en"));
    } catch (error) { notify(error.message, 'error'); }
  });
}

function renderLogin(users) {
  state.user = null; state.day = null; state.turn = null; state.sale = null; state.product = null;
  setScannerEnabled(false);
  const dependents = users.filter(user => user.rol === 'dependiente').slice(0, 2);
  const admin = users.find(user => user.rol === 'administrador');
  state.loginOptions = [...dependents, ...(admin ? [admin] : [])];
  root.innerHTML = `
    <main class="welcome-page">
      <img class="welcome-logo" src="/logo_ch.png" alt="CH">
      <h1>Cajero</h1>
      <div class="welcome-actions">
        ${dependents.map((user, index) => `<button class="welcome-user" data-pick-user="${esc(user.id)}">Dependiente ${index + 1}</button>`).join('')}
        ${admin ? `<button class="welcome-admin" data-pick-user="${esc(admin.id)}">Administración</button>` : ''}
      </div>
    </main>`;
  root.querySelectorAll('[data-pick-user]').forEach(button => {
    button.addEventListener('click', () => {
      const chosen = state.loginOptions.find(user => user.id === button.dataset.pickUser);
      if (chosen) renderPinEntry(chosen);
    });
  });
}

function renderPinEntry(user) {
  state.pendingLoginUser = user;
  setScannerEnabled(false);
  const roleLabel = user.rol === 'administrador' ? 'Administración' : 'Dependiente';
  root.innerHTML = `
    <main class="welcome-page pin-page">
      <img class="welcome-logo" src="/logo_ch.png" alt="CH"><h1>Cajero</h1>
      <p class="pin-role">${roleLabel}</p>
      <form id="login-form" class="pin-form">
        <label for="login-pin">PIN personal</label>
        <input id="login-pin" name="pin" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required autofocus autocomplete="off">
        <button class="btn primary wide" type="submit">Continuar</button>
        <button class="btn secondary wide" id="back-login" type="button">Volver</button>
      </form>
    </main>`;
  document.querySelector('#back-login').onclick = () => renderLogin(state.loginOptions || [user]);
  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!(await verifyPin(new FormData(event.currentTarget).get('pin'), user.pin_hash))) {
      notify('PIN incorrecto.', 'error');
      event.currentTarget.reset();
      document.querySelector('#login-pin')?.focus();
      return;
    }
    state.user = { ...user, turno_id: null };
    const openDay = await one("SELECT * FROM jornadas WHERE estado='abierta' ORDER BY abierta_en DESC LIMIT 1");
    if (openDay) {
      state.day = openDay;
      const activeTurn = await one('SELECT * FROM turnos WHERE fin IS NULL ORDER BY inicio DESC LIMIT 1');
      if (activeTurn) {
        if (activeTurn.usuario_id === user.id) {
          state.turn = activeTurn;
          state.user.turno_id = activeTurn.id;
          state.sale = await one("SELECT * FROM ventas WHERE turno_id=? AND estado='abierta' ORDER BY fecha_hora LIMIT 1", [activeTurn.id]);
          state.view = 'caja';
          renderShell();
          return;
        }
        if (user.rol !== 'administrador') {
          renderTurnBlocked(activeTurn);
          return;
        }
        // El administrador puede revisar y mantener la operación, pero no registrar ventas dentro del turno ajeno.
        state.view = 'admin';
        renderShell();
        return;
      }
      if (user.rol === 'administrador') { state.turn = null; state.sale = null; state.view = 'admin'; renderShell(); return; }
      renderTurnStart();
    } else {
      const closedToday = await one("SELECT * FROM jornadas WHERE fecha=? AND estado='cerrada' LIMIT 1", [localDate()]);
      if (closedToday) renderDayAlreadyClosed(); else renderDayOpening();
    }
  });
}

function renderTurnBlocked(activeTurn) {
  setScannerEnabled(false);
  const openedBy = state.loginOptions?.find(user => user.id === activeTurn.usuario_id)?.nombre || 'otro usuario';
  root.innerHTML = `<main class="auth-page"><img class="welcome-logo" src="/logo_ch.png" alt="CH"><h1>Cajero</h1><div class="panel form-grid"><h2>Hay un turno abierto</h2><p class="muted">El turno de ${esc(openedBy)} todavía no se ha cerrado. Solo puede haber un turno abierto a la vez.</p><button class="btn secondary wide" id="back-login">Volver al acceso</button></div></main>`;
  document.querySelector('#back-login').onclick = () => renderLogin(state.loginOptions || []);
}

function renderTurnStart() {
  setScannerEnabled(false);
  root.innerHTML = `<main class="auth-page"><img class="welcome-logo" src="/logo_ch.png" alt="CH"><h1>Iniciar turno</h1><p class="muted">${esc(state.user.nombre)} · Confirma para comenzar a registrar operaciones a tu nombre.</p><div class="panel form-grid"><button class="btn primary wide" id="start-turn">Abrir mi turno</button><button class="btn secondary wide" id="cancel-turn-start">Volver</button></div></main>`;
  document.querySelector('#start-turn').onclick = async () => {
    const active = await one('SELECT * FROM turnos WHERE fin IS NULL ORDER BY inicio DESC LIMIT 1');
    if (active) return notify('Ya existe otro turno abierto.', 'error');
    const turn = { id: id(), usuario_id: state.user.id, inicio: localDateTime(), fin: null };
    await run('INSERT INTO turnos(id,usuario_id,inicio,fin) VALUES(?,?,?,NULL)', [turn.id, turn.usuario_id, turn.inicio]);
    state.turn = turn; state.user.turno_id = turn.id; state.sale = null; state.view = 'caja';
    await audit(state.user, 'apertura_turno', { turno_id: turn.id, inicio: turn.inicio });
    await renderShell();
  };
  document.querySelector('#cancel-turn-start').onclick = () => renderLogin(state.loginOptions || []);
}

function renderDayOpening() {
  setScannerEnabled(false);
  root.innerHTML = `
    <main class="auth-page">
      <img class="welcome-logo" src="/logo_ch.png" alt="CH"><div class="eyebrow">APERTURA DE CAJA · ${esc(localDate())}</div>
      <h1>Tasa del día</h1><p class="muted">Debes introducir y confirmar la tasa CUP/USD antes de vender.</p>
      <form id="day-form" class="panel form-grid">
        <label>1 USD equivale a<input name="rate" type="number" min="0.01" step="0.01" required placeholder="Ej. 500"></label>
        <div class="info-line">La tasa quedará fija para las ventas del día. Solo el administrador podrá corregirla para ventas futuras.</div>
        <button class="btn primary wide" type="submit">Confirmar tasa y abrir caja</button>
      </form>
      <div class="auth-user">Sesión: ${esc(state.user.nombre)} · ${esc(state.user.rol)}</div>
    </main>`;
  document.querySelector('#day-form').addEventListener('submit', async event => {
    event.preventDefault();
    const rate = moneyInput(new FormData(event.currentTarget).get('rate'));
    if (!Number.isFinite(rate) || rate <= 0) return notify('Introduce una tasa mayor que cero.', 'error');
    try {
      const surcharge = Number(await getConfig('recargo_transferencia') || 20);
      const day = { id: id(), fecha: localDate(), tasa_cup: rate, recargo_transferencia: surcharge, estado: 'abierta', abierta_en: localDateTime() };
      await run('INSERT INTO jornadas(id,fecha,tasa_cup,recargo_transferencia,estado,abierta_en) VALUES(?,?,?,?,?,?)',
        [day.id, day.fecha, day.tasa_cup, day.recargo_transferencia, day.estado, day.abierta_en]);
      await setConfig('tasa_cup', rate);
      await audit(state.user, 'apertura_jornada', { fecha: day.fecha, tasa_cup: rate });
      state.day = day;
      if (state.user.rol === 'administrador') {
        state.turn = null; state.user.turno_id = null; state.sale = null; state.view = 'admin';
        await audit(state.user, 'apertura_jornada_por_administrador', { fecha: day.fecha, tasa_cup: rate });
      } else {
        const turn = { id: id(), usuario_id: state.user.id, inicio: localDateTime(), fin: null };
        await run('INSERT INTO turnos(id,usuario_id,inicio,fin) VALUES(?,?,?,NULL)', [turn.id, turn.usuario_id, turn.inicio]);
        state.turn = turn; state.user.turno_id = turn.id; state.sale = null; state.view = 'caja';
        await audit(state.user, 'apertura_turno', { turno_id: turn.id, inicio: turn.inicio });
      }
      renderShell();
    } catch (error) { notify(error.message, 'error'); }
  });
}

start();

async function renderShell() {
  if (!state.user || !state.day) return renderLogin(await query('SELECT * FROM usuarios WHERE activo=1 ORDER BY nombre'));
  const store = await getConfig('nombre_tienda') || 'CH Cajero';
  const rate = Number(state.day.tasa_cup);
  const cart = state.sale ? await getSaleLines(state.sale.id) : [];
  const total = calculateCartTotal(cart);
  const nav = [
    ['caja','Caja','⌂'], ['productos','Productos','▤'], ['inventario','Inventario','▥'], ['historial','Historial','◷'],
    ...(state.user.rol === 'administrador' ? [['admin','Administración','⚙']] : [])
  ];
  const daySales = await one("SELECT COUNT(*) AS cantidad FROM ventas WHERE jornada_id=? AND estado IN ('cerrada','anulada','cancelada')", [state.day.id]);
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="top-brand"><span class="mini-mark">CH</span><div><strong>${esc(store)}</strong><small>${esc(state.user.nombre)} · ${state.user.rol === 'administrador' ? 'Administrador' : 'Dependiente'}</small></div></div>
        <div class="top-status"><span class="status-dot"></span><span>OFFLINE</span><span class="rate-chip">1 USD = ${esc(rate)} CUP</span>${state.turn ? `<button class="turn-chip" data-act="close-turn">Cerrar turno</button>` : ''}</div>
      </header>
      <div class="main-layout">
        <aside class="sidebar">
          ${nav.map(([key,label,icon]) => `<button class="nav-item ${state.view===key?'active':''}" data-go="${key}"><span>${icon}</span>${label}</button>`).join('')}
          <div class="sidebar-bottom"><div class="day-mini">CAJA DEL DÍA<strong>${esc(state.day.fecha)}</strong><small>${daySales?.cantidad || 0} ventas cerradas/anuladas</small></div>${state.turn ? '<button class="nav-item logout" data-act="close-turn">↪ Cerrar turno</button>' : '<button class="nav-item logout" data-act="logout">↪ Salir</button>'}</div>
        </aside>
        <main class="content-area">
          ${state.view === 'caja' ? await renderCashier(cart, total) : ''}
          ${state.view === 'productos' ? await renderProducts() : ''}
          ${state.view === 'historial' ? await renderHistory() : ''}
          ${state.view === 'inventario' ? await renderInventory() : ''}
          ${state.view === 'admin' && state.user.rol === 'administrador' ? await renderAdmin() : ''}
          ${state.view === 'auditoria' && state.user.rol === 'administrador' ? await renderAuditLog() : ''}
          ${state.view === 'cobro' ? await renderPayment() : ''}
          ${state.view === 'cierres' ? await renderClosures() : ''}
        </main>
      </div>
      <div id="modal-root"></div>
    </div>`;
  bindShell();
  setScannerEnabled(['caja','inventario'].includes(state.view) && Boolean(state.user) && !state.product);
  monitorScannerStatus();
}

function monitorScannerStatus() {
  if (scannerStatusTimer) clearInterval(scannerStatusTimer);
  scannerStatusTimer = null;
  if (!['caja','inventario'].includes(state.view)) return;
  const refresh = async () => {
    const pill = document.querySelector('#scanner-status');
    if (!pill) return;
    const status = await getScannerStatus();
    pill.classList.toggle('disconnected', !status.connected);
    pill.textContent = status.connected ? 'PISTOLA CONECTADA' : 'ESPERANDO LECTOR';
    pill.title = status.deviceName || (status.supported ? 'Conecta la pistola USB mediante OTG.' : 'El estado del lector se verifica dentro de la APK Android.');
  };
  refresh();
  scannerStatusTimer = setInterval(refresh, 1800);
}

async function getSaleLines(saleId) {
  return query('SELECT l.*, p.foto_base64 AS foto_base64 FROM lineas_venta l LEFT JOIN productos p ON p.codigo=l.codigo WHERE l.venta_id=? ORDER BY l.rowid', [saleId]);
}

async function getSalePayments(saleId) {
  return query('SELECT * FROM pagos WHERE venta_id=? ORDER BY fecha_hora,rowid', [saleId]);
}

async function getSaleTotals(saleId) {
  const sale = await one('SELECT * FROM ventas WHERE id=?', [saleId]);
  const lines = await getSaleLines(saleId);
  const total = calculateCartTotal(lines);
  const payments = await getSalePayments(saleId);
  return { sale, lines, payments, ...summarizeSale(total, payments) };
}

async function renderCashier(cart, total) {
  const paused = await query("SELECT id,numero_local,fecha_hora,total_usd FROM ventas WHERE jornada_id=? AND estado='pausada' ORDER BY fecha_hora DESC", [state.day.id]);
  const paymentCount = state.sale ? await one("SELECT COUNT(*) AS n FROM pagos WHERE venta_id=? AND estado='activo'", [state.sale.id]) : { n: 0 };
  const canOpenPayment = cart.length > 0 || Number(paymentCount?.n || 0) > 0;
  const hideExpectedStock = state.user.rol === 'dependiente' && Boolean(await one("SELECT id FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo') LIMIT 1", [state.user.id]));
  const currentCard = state.product ? `
    <div class="product-focus">
      <div class="product-photo">${state.product.foto_base64 ? `<img src="data:image/jpeg;base64,${state.product.foto_base64}" alt="">` : '<span>CH</span>'}</div>
      <div class="product-main"><div class="muted tiny">PRODUCTO RECONOCIDO</div><h2>${esc(state.product.nombre)}</h2><div class="product-code">${esc(state.product.codigo)}</div><div class="product-stats"><strong>${formatUSD(state.product.precio_usd)}</strong>${hideExpectedStock ? '' : `<span>Stock: ${Number(state.product.stock)}</span>`}</div></div>
      <div class="quantity-box"><small>CANTIDAD</small><div class="qty-control"><button data-act="qty-minus" aria-label="Restar cantidad">−</button><input id="product-qty" type="number" min="1" max="9999" step="1" inputmode="numeric" value="${state.productQty}" aria-label="Cantidad del producto"><button data-act="qty-plus" aria-label="Aumentar cantidad">+</button></div><button class="btn primary" data-act="add-product">Añadir</button></div>
    </div>` : `
    <div class="scan-placeholder"><div class="scan-icon">⌁</div><h2>Listo para escanear</h2><p>Conecta la pistola Netum L3 mediante el adaptador OTG y escanea el código del producto.</p><div class="scan-tip">La aplicación captura el código sin abrir el teclado del teléfono.</div></div>`;
  return `
    <section class="page-head"><div><div class="eyebrow">PUNTO DE VENTA</div><h1>Caja</h1><p class="muted">Escanea, añade al carrito y continúa con el siguiente producto.</p></div>
      <div class="head-actions"><button class="btn secondary" data-act="review-close-day">Cierre diario</button><div class="total-box"><small>TOTAL DE LA VENTA</small><strong>${formatUSD(total)}</strong><span>${state.sale ? `Venta #${state.sale.numero_local}` : 'Sin venta activa'}</span></div></div>
    </section>
    <div class="cash-grid">
      <section class="panel scan-panel"><div class="section-title"><h3>Escáner y producto</h3><span id="scanner-status" class="connected-pill disconnected" aria-live="polite"><i></i> ESPERANDO LECTOR</span></div>${currentCard}
        <div class="manual-code"><label for="manual-code">Código manual</label><div><input id="manual-code" placeholder="Escribir código y pulsar Buscar" autocomplete="off"><button class="btn secondary" data-act="manual-scan">Buscar</button></div></div>
      </section>
      <section class="panel cart-panel"><div class="section-title"><h3>Carrito</h3><span class="count-pill">${cart.length} líneas</span></div>
        ${cart.length ? `<div class="cart-list">${cart.map(line => `<div class="cart-line"><div class="line-thumb">${line.foto_base64 ? `<img src="data:image/jpeg;base64,${line.foto_base64}" alt="">` : '<span>CH</span>'}</div><div class="line-main"><strong>${esc(line.nombre_snapshot)}</strong><small>${esc(line.codigo)} · ${formatUSD(line.precio_snapshot)} c/u</small></div><div class="line-qty"><button data-act="line-minus" data-id="${esc(line.id)}">−</button><b>${line.cantidad}</b><button data-act="line-plus" data-id="${esc(line.id)}">+</button></div><strong>${formatUSD(line.precio_snapshot*line.cantidad)}</strong><button class="remove-line" data-act="line-remove" data-id="${esc(line.id)}" aria-label="Eliminar">×</button></div>`).join('')}</div>` : '<div class="empty-cart">El carrito está vacío. Escanea un código para comenzar.</div>'}
        <div class="cart-footer"><div class="total-line"><span>Total USD</span><strong>${formatUSD(total)}</strong></div><div class="cart-actions"><button class="btn secondary" data-act="pause-sale" ${!state.sale?'disabled':''}>Pausar</button><button class="btn secondary" data-act="new-sale">Nueva venta</button><button class="btn primary" data-act="go-payment" ${!canOpenPayment?'disabled':''}>Cobrar</button></div><div class="cart-destructive"><button class="btn danger-outline" data-act="cancel-sale" data-id="${esc(state.sale?.id || '')}" ${!state.sale?'disabled':''}>Eliminar venta</button></div></div>
      </section>
    </div>
    <section class="panel paused-panel"><div class="section-title"><h3>Ventas en pausa</h3><span class="count-pill">${paused.length}</span></div>
      ${paused.length ? `<div class="paused-list">${paused.map(item => `<div class="paused-row"><div><strong>Venta #${item.numero_local}</strong><small>${localTime(item.fecha_hora)} · ${formatUSD(item.total_usd || 0)}</small></div><div class="button-row"><button class="btn small secondary" data-act="resume-sale" data-id="${esc(item.id)}">Retomar</button><button class="btn small danger-outline" data-act="cancel-sale" data-id="${esc(item.id)}">Eliminar</button></div></div>`).join('')}</div>` : '<p class="muted">No hay ventas pausadas.</p>'}
    </section>`;
}

async function renderInventory() {
  const products = await query('SELECT codigo,nombre,stock FROM productos ORDER BY nombre COLLATE NOCASE');
  const pendingEntries = state.user.rol === 'administrador'
    ? await query("SELECT m.*,p.nombre FROM movimientos_inventario m JOIN productos p ON p.codigo=m.codigo WHERE m.tipo='entrada' AND m.estado='pendiente_confirmacion' ORDER BY m.fecha_hora")
    : [];
  const activeCount = await one("SELECT * FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo') ORDER BY fecha_inicio DESC LIMIT 1", [state.user.id]);
  let countDetails = [];
  let uncounted = products;
  if (activeCount) {
    countDetails = await query('SELECT d.*,p.nombre FROM conteo_detalle d JOIN productos p ON p.codigo=d.codigo WHERE d.conteo_id=? ORDER BY p.nombre COLLATE NOCASE', [activeCount.id]);
    if (activeCount.estado === 'reconteo') {
      const pendingCodes = new Set(countDetails.filter(row => row.conteo_2 === null || row.conteo_2 === undefined).map(row => row.codigo));
      uncounted = products.filter(product => pendingCodes.has(product.codigo));
    } else {
      const seen = new Set(countDetails.map(row => row.codigo));
      uncounted = products.filter(product => !seen.has(product.codigo));
    }
  }
  const pendingReview = state.user.rol === 'administrador'
    ? await query("SELECT d.*,p.nombre,c.usuario_id,c.fecha_inicio FROM conteo_detalle d JOIN productos p ON p.codigo=d.codigo JOIN conteos c ON c.id=d.conteo_id WHERE d.resultado IN ('pendiente_verificar','inconsistente') ORDER BY c.fecha_inicio,p.nombre")
    : [];
  const hideStockForCount = state.user.rol === 'dependiente' && Boolean(activeCount);
  const hideRecountNumbers = state.user.rol === 'dependiente' && activeCount?.estado === 'reconteo';
  const countProgress = activeCount?.estado === 'reconteo'
    ? `${countDetails.filter(row => row.conteo_2 !== null && row.conteo_2 !== undefined).length} de ${countDetails.length} productos del reconteo registrados`
    : `${countDetails.length} de ${products.length} productos registrados`;
  const countTableRows = countDetails.map(row => {
    const quantityCell = hideRecountNumbers ? '' : `<td>${row.conteo_2!==null && row.conteo_2!==undefined ? Number(row.conteo_2) : Number(row.conteo_1)}</td>`;
    const status = hideRecountNumbers ? recountProgressLabel(row) : (row.resultado==='reconteo_pendiente'?'Pendiente de reconteo':row.resultado);
    return `<tr><td>${esc(row.nombre)}</td><td class="code-text">${esc(row.codigo)}</td>${quantityCell}<td>${esc(status)}</td></tr>`;
  }).join('');
  const stockRows = products.map(product => `<tr><td>${esc(product.nombre)}</td><td class="code-text">${esc(product.codigo)}</td>${hideStockForCount ? '' : `<td><span class="stock-number ${Number(product.stock)===0?'stock-zero':Number(product.stock)<=5?'stock-low':''}">${Number(product.stock)}</span></td>`}</tr>`).join('');
  const countPanel = activeCount ? `
    <section class="panel count-panel">
      <div class="section-title"><div><h3>Conteo semanal en curso</h3><small class="muted">Inicio: ${new Date(activeCount.fecha_inicio).toLocaleString('es-CU')}</small></div><span class="tag tag-warn">${activeCount.estado==='reconteo'?'RECONTEO':'EN CURSO'}</span></div>
      <p class="muted">Conteo ciego: no se muestra el stock esperado. Escanea el código, introduce la cantidad física y pulsa Registrar. Para un producto sin unidades, escribe 0 expresamente.</p>
      <div class="inventory-input-row"><label>Código escaneado<input id="count-code" placeholder="Escanea o escribe el código"></label><label>Cantidad contada<input id="count-qty" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></label><button class="btn primary" data-act="inventory-add-count">Registrar</button></div>
      <div class="table-wrap"><table><thead><tr><th>Producto contado</th><th>Código</th>${hideRecountNumbers?'':'<th>Cantidad registrada</th>'}<th>Estado</th></tr></thead><tbody>${countTableRows || `<tr><td colspan="${hideRecountNumbers?3:4}" class="empty-cell">Aún no se han contado productos.</td></tr>`}</tbody></table></div>
      <div class="count-finish-row"><span>${countProgress} · ${uncounted.length} pendientes de contar</span><button class="btn secondary" data-act="inventory-submit-count">${activeCount.estado==='reconteo'?'Finalizar reconteo':'Finalizar primer conteo'}</button></div>
      ${uncounted.length ? `<details class="uncounted-list"><summary>Productos sin escanear (${uncounted.length})</summary><p class="muted">Deben registrarse uno por uno. Para indicar que no hay existencias, introduce 0 explícitamente.</p>${uncounted.slice(0,120).map(product=>`<div class="uncounted-item">${esc(product.nombre)} <small>${esc(product.codigo)}</small></div>`).join('')}${uncounted.length>120?'<p class="muted">Lista limitada a 120; el conteo exige registrar todos.</p>':''}</details>` : ''}
    </section>` : `
    <section class="panel count-panel"><div class="section-title"><h3>Conteo semanal</h3><span class="tag tag-catalog">Sin conteo activo</span></div><p class="muted">El conteo no muestra al dependiente el stock esperado. Al terminar, las diferencias pasan por un único reconteo.</p><button class="btn primary" data-act="inventory-start-count" ${!state.turn && state.user.rol!=='administrador'?'disabled':''}>Iniciar conteo semanal</button>${!state.turn && state.user.rol!=='administrador'?'<p class="muted">Debes abrir un turno para comenzar.</p>':''}</section>`;
  return `<section class="page-head"><div><div class="eyebrow">MOVIMIENTOS DE EXISTENCIAS</div><h1>Inventario</h1><p class="muted">El stock cambia mediante movimientos registrados, no mediante edición manual.</p></div><span id="scanner-status" class="connected-pill disconnected"><i></i> ESPERANDO LECTOR</span><span class="count-pill">${products.length} productos</span></section>
    <div class="inventory-grid">
      <section class="panel"><div class="section-title"><h3>Entrada de mercancía</h3><span class="tag tag-catalog">Dependiente / Admin</span></div><form id="inventory-entry-form" class="form-grid"><label>Código del producto<input id="inventory-code" name="code" required autocomplete="off" placeholder="Escanea con la pistola"></label><div class="two-cols"><label>Cantidad<input name="quantity" type="number" min="1" step="1" required></label><label>Nota opcional<input name="note" maxlength="160" placeholder="Proveedor, factura…"></label></div><button class="btn primary" type="submit">Registrar entrada</button></form><p class="muted">La entrada suma al stock al instante y queda pendiente de confirmación del administrador.</p></section>
      ${state.user.rol==='administrador'?`<section class="panel"><div class="section-title"><h3>Salida de inventario</h3><span class="tag tag-danger">Solo administrador</span></div><form id="inventory-exit-form" class="form-grid"><label>Código del producto<input id="inventory-exit-code" name="code" required autocomplete="off" placeholder="Código o lectura"></label><div class="two-cols"><label>Cantidad<input name="quantity" type="number" min="1" step="1" required></label><label>Motivo<select name="reason" required><option value="">Seleccionar</option><option>envío</option><option>entrega</option><option>regalo</option><option>merma</option><option>uso interno</option></select></label></div><label>Destinatario / nota<input name="note" maxlength="160"></label><button class="btn danger-outline" type="submit">Registrar salida</button></form></section>`:''}
    </div>
    ${countPanel}
    ${state.user.rol==='administrador'?`<section class="panel"><div class="section-title"><h3>Entradas pendientes de confirmación</h3><span class="count-pill">${pendingEntries.length}</span></div>${pendingEntries.length?pendingEntries.map(row=>`<div class="closure-row"><div><strong>${esc(row.nombre)} · +${row.cantidad}</strong><small>${esc(row.codigo)} · ${new Date(row.fecha_hora).toLocaleString('es-CU')} · ${esc(row.usuario)}</small></div><button class="btn small secondary" data-act="inventory-confirm-entry" data-id="${esc(row.id)}">Confirmar</button></div>`).join(''):'<p class="muted">No hay entradas pendientes.</p>'}</section>
    <section class="panel"><div class="section-title"><h3>Pendientes de verificar del conteo</h3><span class="count-pill">${pendingReview.length}</span></div>${pendingReview.length?pendingReview.map(row=>`<div class="review-row"><div><strong>${esc(row.nombre)} · ${esc(row.codigo)}</strong><small>Esperado: ${row.esperado_al_contar} · Conteo 1: ${row.conteo_1} · Conteo 2: ${row.conteo_2} · Diferencia: ${Number(row.conteo_2)-Number(row.esperado_al_contar)}</small></div><div class="button-row"><button class="btn small primary" data-act="inventory-review-accept" data-id="${esc(row.id)}">Aceptar</button><button class="btn small secondary" data-act="inventory-review-keep" data-id="${esc(row.id)}">Mantener</button><button class="btn small secondary" data-act="inventory-review-recount" data-id="${esc(row.id)}">Recontar</button></div></div>`).join(''):'<p class="muted">No hay productos pendientes de revisión.</p>'}</section>`:''}
    <section class="panel"><div class="section-title"><h3>Existencias actuales</h3><span class="muted">Ámbar = stock bajo o agotado</span></div><div class="table-wrap"><table><thead><tr><th>Producto</th><th>Código</th>${hideStockForCount ? '' : '<th>Stock actual</th>'}</tr></thead><tbody>${stockRows||`<tr><td colspan="${hideStockForCount?2:3}" class="empty-cell">No hay productos cargados.</td></tr>`}</tbody></table></div></section>`;
}

async function registerInventoryEntry() {
  const form = document.querySelector('#inventory-entry-form');
  if (!form) return;
  const values = new FormData(form);
  const code = String(values.get('code') || '').trim();
  const quantity = Number(values.get('quantity'));
  const note = String(values.get('note') || '').trim();
  if (!code || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Introduce un código y una cantidad entera mayor que cero.');
  const product = await one('SELECT * FROM productos WHERE codigo=?', [code]);
  if (!product) {
    state.pendingInventoryEntry = { code, quantity, note };
    await openNewProductModal(code);
    notify('Código nuevo: completa los datos del producto. Después se registrará esta entrada.', 'info');
    return;
  }
  const movementId = id();
  const beforeStock = Number(product.stock); const afterStock = beforeStock + quantity;
  await transaction(async () => {
    await run('UPDATE productos SET stock=stock+?,actualizado_en=? WHERE codigo=?', [quantity,localDateTime(),code]);
    await run(`INSERT INTO movimientos_inventario(id,tipo,codigo,cantidad,fecha_hora,usuario_id,usuario,turno_id,motivo,nota,estado,movimiento_origen,stock_antes,stock_despues)
      VALUES(?,'entrada',?,?,?,?,?,?,?,?,'pendiente_confirmacion',NULL,?,?)`,
      [movementId,code,quantity,localDateTime(),state.user.id,state.user.nombre,state.turn?.id||null,'entrada de mercancía',note,beforeStock,afterStock]);
    await audit(state.user, 'entrada_inventario', { movimiento_id: movementId, codigo: code, cantidad: quantity, nota });
  });
  form.reset(); await renderShell(); notify('Entrada registrada. El stock aumentó y quedó pendiente de confirmación.', 'success');
}

async function registerInventoryExit() {
  if (state.user.rol !== 'administrador') throw new Error('Solo el administrador puede registrar salidas.');
  const form = document.querySelector('#inventory-exit-form');
  if (!form) return;
  const values = new FormData(form);
  const code = String(values.get('code') || '').trim();
  const quantity = Number(values.get('quantity'));
  const reason = String(values.get('reason') || '');
  const note = String(values.get('note') || '').trim();
  if (!code || !Number.isInteger(quantity) || quantity <= 0 || !['envío','entrega','regalo','merma','uso interno'].includes(reason)) throw new Error('Revisa el código, la cantidad y el motivo de la salida.');
  const admin = await requestAdminPin('Registrar una salida de inventario');
  if (!admin) return;
  const product = await one('SELECT * FROM productos WHERE codigo=?', [code]);
  if (!product) throw new Error('No existe un producto con ese código.');
  if (Number(product.stock) < quantity) throw new Error(`Stock insuficiente: hay ${product.stock} unidades.`);
  const movementId = id();
  const beforeStock = Number(product.stock); const afterStock = beforeStock - quantity;
  await transaction(async () => {
    await run('UPDATE productos SET stock=stock-?,actualizado_en=? WHERE codigo=?', [quantity,localDateTime(),code]);
    await run(`INSERT INTO movimientos_inventario(id,tipo,codigo,cantidad,fecha_hora,usuario_id,usuario,turno_id,motivo,nota,estado,movimiento_origen,stock_antes,stock_despues)
      VALUES(?,'salida',?,?,?,?,?,?,?,?,'confirmado',NULL,?,?)`,
      [movementId,code,quantity,localDateTime(),admin.id,admin.nombre,state.turn?.id||null,reason,note,beforeStock,afterStock]);
    await audit(admin, 'salida_inventario', { movimiento_id: movementId, codigo: code, cantidad: quantity, motivo: reason, nota });
  });
  form.reset(); await renderShell(); notify('Salida registrada. El stock fue actualizado.', 'success');
}

async function confirmInventoryEntry(movementId) {
  const admin = await requestAdminPin('Confirmar una entrada de mercancía');
  if (!admin) return;
  const movement = await one("SELECT * FROM movimientos_inventario WHERE id=? AND tipo='entrada' AND estado='pendiente_confirmacion'", [movementId]);
  if (!movement) throw new Error('La entrada ya fue confirmada o no existe.');
  await transaction(async () => {
    await run("UPDATE movimientos_inventario SET estado='confirmado' WHERE id=? AND estado='pendiente_confirmacion'", [movementId]);
    await audit(admin, 'confirmar_entrada_inventario', { movimiento_id: movementId, codigo: movement.codigo, cantidad: movement.cantidad, registrada_por: movement.usuario });
  });
  await renderShell(); notify('Entrada confirmada.', 'success');
}

async function startInventoryCount() {
  if (state.user.rol !== 'administrador' && (!state.turn || state.turn.usuario_id !== state.user.id)) throw new Error('Debes abrir tu turno antes de iniciar el conteo.');
  const active = await one("SELECT id FROM conteos WHERE estado IN ('en_curso','reconteo') LIMIT 1");
  if (active) throw new Error('Ya existe un conteo en curso. Debe terminarse antes de iniciar otro.');
  const count = { id: id(), fecha_inicio: localDateTime(), usuario_id: state.user.id, turno_id: state.turn?.id || null, estado: 'en_curso' };
  await run('INSERT INTO conteos(id,fecha_inicio,usuario_id,turno_id,estado) VALUES(?,?,?,?,?)', [count.id,count.fecha_inicio,count.usuario_id,count.turno_id,count.estado]);
  await audit(state.user, 'inicio_conteo_semanal', { conteo_id: count.id, inicio: count.fecha_inicio });
  await renderShell();
}

async function addInventoryCountItem() {
  const code = String(document.querySelector('#count-code')?.value || '').trim();
  const quantity = Number(document.querySelector('#count-qty')?.value);
  if (!code || !Number.isInteger(quantity) || quantity < 0) throw new Error('Introduce el código y una cantidad entera; 0 debe indicarse expresamente.');
  const count = await one("SELECT * FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo') ORDER BY fecha_inicio DESC LIMIT 1", [state.user.id]);
  if (!count) throw new Error('No hay un conteo abierto.');
  const product = await one('SELECT codigo,nombre,stock FROM productos WHERE codigo=?', [code]);
  if (!product) throw new Error('Ese código no existe en el catálogo.');
  const existing = await one('SELECT * FROM conteo_detalle WHERE conteo_id=? AND codigo=?', [count.id,code]);
  if (existing && existing.conteo_1 !== null && existing.conteo_1 !== undefined && count.estado !== 'reconteo') throw new Error('Este producto ya fue contado.');
  const now = localDateTime();
  if (count.estado === 'reconteo') {
    if (!existing || existing.resultado !== 'reconteo_pendiente') throw new Error('Este producto no forma parte de la lista de reconteo.');
    if (existing.conteo_1 === null || existing.conteo_1 === undefined) {
      await run('UPDATE conteo_detalle SET conteo_1=?,hora_1=?,conteo_2=?,hora_2=? WHERE id=?', [quantity,now,quantity,now,existing.id]);
    } else {
      await run('UPDATE conteo_detalle SET conteo_2=?,hora_2=? WHERE id=?', [quantity,now,existing.id]);
    }
  } else if (existing) {
    throw new Error('Este producto ya fue registrado en el conteo.');
  } else {
    await run(`INSERT INTO conteo_detalle(id,conteo_id,codigo,esperado_al_contar,conteo_1,hora_1,conteo_2,hora_2,resultado,decision_admin,motivo,visible_para)
      VALUES(?,?,?,?,?,?,NULL,NULL,'reconteo_pendiente',NULL,NULL,'administrador')`,
      [id(),count.id,code,Number(product.stock),quantity,now]);
  }
  await audit(state.user, count.estado === 'reconteo' ? 'registrar_reconteo' : 'registrar_conteo_producto', { conteo_id: count.id, codigo: code, cantidad: quantity, hora: now });
  await renderShell(); notify('Conteo registrado.', 'success');
}

async function submitInventoryCount() {
  const count = await one("SELECT * FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo') ORDER BY fecha_inicio DESC LIMIT 1", [state.user.id]);
  if (!count) throw new Error('No hay un conteo activo.');
  if (count.estado === 'reconteo') return submitInventoryRecount();
  const allProducts = await query('SELECT codigo,nombre FROM productos ORDER BY nombre COLLATE NOCASE');
  const recorded = await query('SELECT codigo,conteo_1 FROM conteo_detalle WHERE conteo_id=?', [count.id]);
  const seen = new Set(recorded.map(row=>row.codigo));
  const missing = allProducts.filter(product=>!seen.has(product.codigo));
  if (missing.length) {
    state.pendingMissingCountRows = { countId: count.id, products: missing };
    setModal(`<div class="modal-head"><span class="eyebrow">PRODUCTOS SIN CONTAR</span><button class="icon-close" data-act="modal-close">×</button></div><h2>Completa los productos faltantes</h2><p class="muted">Hay ${missing.length} productos sin registro. Introduce la cantidad física de cada uno; cuando no haya existencias, escribe 0. No se completa nada automáticamente.</p><form id="missing-count-form" class="form-grid">${missing.map(product=>`<label>${esc(product.nombre)} · <span class="code-text">${esc(product.codigo)}</span><input data-missing-code="${esc(product.codigo)}" type="number" min="0" step="1" required inputmode="numeric" placeholder="Cantidad contada"></label>`).join('')}<div class="modal-actions"><button type="button" class="btn secondary" data-act="modal-close">Cancelar</button><button class="btn primary" type="submit">Guardar conteos faltantes</button></div></form>`);
    const host=document.querySelector('#modal-root');
    host.querySelectorAll('[data-act="modal-close"]').forEach(btn=>btn.onclick=closeModal);
    host.querySelector('#missing-count-form').onsubmit=async event=>{event.preventDefault();await confirmMissingInventoryCounts();};
    return;
  }
  await evaluateFirstInventoryCount(count.id);
}

async function confirmMissingInventoryCounts() {
  const pending = state.pendingMissingCountRows;
  const host = document.querySelector('#modal-root');
  const form = host?.querySelector('#missing-count-form');
  if (!pending || !form) throw new Error('No hay productos pendientes de completar.');
  const inputs = [...form.querySelectorAll('[data-missing-code]')];
  const rows = inputs.map(input=>({codigo:input.dataset.missingCode,cantidad:Number(input.value)}));
  if (rows.some(row=>!Number.isInteger(row.cantidad)||row.cantidad<0)) throw new Error('Debes introducir una cantidad entera para cada producto; utiliza 0 cuando no haya existencias.');
  const now=localDateTime();
  await transaction(async()=>{
    for(const row of rows){
      const product=await one('SELECT stock FROM productos WHERE codigo=?',[row.codigo]);
      await run(`INSERT INTO conteo_detalle(id,conteo_id,codigo,esperado_al_contar,conteo_1,hora_1,resultado,visible_para)
        VALUES(?,?,?,?,?,?,'reconteo_pendiente','administrador')`,[id(),pending.countId,row.codigo,Number(product?.stock||0),row.cantidad,now]);
    }
    await audit(state.user,'completar_productos_no_escaneados',{conteo_id:pending.countId,cantidad:rows.length});
  });
  state.pendingMissingCountRows=null; closeModal();
  await evaluateFirstInventoryCount(pending.countId);
}

async function evaluateFirstInventoryCount(countId) {
  const details=await query('SELECT * FROM conteo_detalle WHERE conteo_id=?',[countId]);
  const recount = selectInventoryRecountRows(details);
  const recountIds=new Set(recount.selected.map(row=>row.id));
  await transaction(async()=>{
    for(const row of details){
      if(recountIds.has(row.id)) await run("UPDATE conteo_detalle SET resultado='reconteo_pendiente' WHERE id=?",[row.id]);
      else await run("UPDATE conteo_detalle SET resultado='coincide',visible_para=NULL WHERE id=?",[row.id]);
    }
    const status=recountIds.size?'reconteo':'confirmado';
    await run('UPDATE conteos SET estado=?,fecha_fin=? WHERE id=?',[status,recountIds.size?null:localDateTime(),countId]);
    await audit(state.user,'comparar_conteo_inicial',{conteo_id:countId,productos:details.length,reconteos:recountIds.size});
  });
  await renderShell();
  notify(recountIds.size?`Debes recontear ${recountIds.size} productos. La lista no indica cuáles tuvieron diferencias.`:'Conteo confirmado sin diferencias.', 'success');
}

async function submitInventoryRecount() {
  const count=await one("SELECT * FROM conteos WHERE usuario_id=? AND estado='reconteo' ORDER BY fecha_inicio DESC LIMIT 1",[state.user.id]);
  if(!count) throw new Error('No hay un reconteo pendiente.');
  const rows=await query("SELECT * FROM conteo_detalle WHERE conteo_id=? AND resultado='reconteo_pendiente'",[count.id]);
  if(rows.some(row=>row.conteo_2===null||row.conteo_2===undefined)) throw new Error('Debes recontear todos los productos indicados.');
  await transaction(async()=>{
    for(const row of rows){
      const result = recountResult(row.esperado_al_contar, row.conteo_1, row.conteo_2);
      if(result==='coincide'){
        const delta=Number(row.conteo_2)-Number(row.esperado_al_contar);
        const current=await one('SELECT stock FROM productos WHERE codigo=?',[row.codigo]);
        if(Number(current?.stock||0)+delta<0){
          await run("UPDATE conteo_detalle SET resultado='pendiente_verificar',visible_para='administrador' WHERE id=?",[row.id]);
          continue;
        }
        if(delta!==0){
          const beforeStock = Number(current?.stock || 0);
          const afterStock = beforeStock + delta;
          await run('UPDATE productos SET stock=stock+?,actualizado_en=? WHERE codigo=?',[delta,localDateTime(),row.codigo]);
          await run(`INSERT INTO movimientos_inventario(id,tipo,codigo,cantidad,fecha_hora,usuario_id,usuario,turno_id,motivo,nota,estado,movimiento_origen,stock_antes,stock_despues)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id(),'ajuste_conteo',row.codigo,delta,localDateTime(),state.user.id,state.user.nombre,state.turn?.id||null,'reconteo aceptado','Ajuste automático por reconteo','confirmado',row.id,beforeStock,afterStock]);
        }
        await run("UPDATE conteo_detalle SET resultado='coincide',visible_para=NULL WHERE id=?",[row.id]);
      } else {
        await run("UPDATE conteo_detalle SET resultado=?,visible_para='administrador' WHERE id=?",[result,row.id]);
      }
    }
    await run("UPDATE conteos SET estado='confirmado',fecha_fin=? WHERE id=?",[localDateTime(),count.id]);
    await audit(state.user,'finalizar_reconteo',{conteo_id:count.id,pendientes_admin:rows.filter(row=>Number(row.conteo_1)!==Number(row.conteo_2)).length});
  });
  await renderShell(); notify('Reconteo terminado. Los pendientes de verificar solo son visibles para el administrador.', 'success');
}

async function reviewInventoryCount(detailId, decision) {
  if(state.user.rol!=='administrador') throw new Error('Solo el administrador puede revisar conteos.');
  const admin=await requestAdminPin('Resolver un pendiente de verificar del inventario');
  if(!admin) return;
  const detail=await one("SELECT d.*,p.stock,p.nombre,c.usuario_id,c.turno_id FROM conteo_detalle d JOIN productos p ON p.codigo=d.codigo JOIN conteos c ON c.id=d.conteo_id WHERE d.id=? AND d.resultado IN ('pendiente_verificar','inconsistente')",[detailId]);
  if(!detail) throw new Error('El pendiente ya fue resuelto o no existe.');
  if(decision==='recontar'){
    const newCountId=id(); const start=localDateTime();
    await transaction(async()=>{
      await run("INSERT INTO conteos(id,fecha_inicio,usuario_id,turno_id,estado) VALUES(?,?,?,NULL,'reconteo')",[newCountId,start,detail.usuario_id]);
      await run("INSERT INTO conteo_detalle(id,conteo_id,codigo,esperado_al_contar,resultado,visible_para) VALUES(?,?,?,?,'reconteo_pendiente','dependiente')",[id(),newCountId,detail.codigo,Number(detail.stock)]);
      await run("UPDATE conteo_detalle SET resultado='revisado',decision_admin='reconteo_ordenado',motivo='Se ordenó nuevo conteo' WHERE id=?",[detailId]);
      await audit(admin,'ordenar_reconteo',{codigo:detail.codigo,conteo_anterior:detailId,conteo_nuevo:newCountId});
    });
  } else {
    const reason = window.prompt('Motivo: error de conteo, merma o pérdida, entrada sin registrar, salida sin registrar u otro.');
    const allowed=['error de conteo','merma o pérdida','entrada sin registrar','salida sin registrar','otro'];
    if(!allowed.includes(String(reason||'').trim().toLowerCase())) throw new Error('Selecciona uno de los motivos permitidos.');
    await transaction(async()=>{
      if(decision==='aceptar'){
        const delta=Number(detail.conteo_2)-Number(detail.esperado_al_contar);
        if(delta<0 && Number(detail.stock)<Math.abs(delta)) throw new Error('El ajuste produciría un stock negativo; revisa movimientos posteriores al conteo.');
        const beforeStock = Number(detail.stock);
        const afterStock = beforeStock + delta;
        await run('UPDATE productos SET stock=stock+?,actualizado_en=? WHERE codigo=?',[delta,localDateTime(),detail.codigo]);
        await run(`INSERT INTO movimientos_inventario(id,tipo,codigo,cantidad,fecha_hora,usuario_id,usuario,turno_id,motivo,nota,estado,movimiento_origen,stock_antes,stock_despues)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id(),'ajuste_conteo',detail.codigo,delta,localDateTime(),admin.id,admin.nombre,state.turn?.id||null,reason,`Ajuste de ${delta} unidades`,'confirmado',detailId,beforeStock,afterStock]);
      }
      await run("UPDATE conteo_detalle SET resultado='revisado',decision_admin=?,motivo=?,visible_para=NULL WHERE id=?",[decision,reason,detailId]);
      await audit(admin,'resolver_conteo_pendiente',{detalle_id:detailId,codigo:detail.codigo,decision,motivo:reason});
    });
  }
  await renderShell(); notify('Revisión de inventario registrada.', 'success');
}

async function renderProducts() {
  const products = await query('SELECT * FROM productos ORDER BY nombre COLLATE NOCASE');
  const activeCount = state.user.rol === 'dependiente' && Boolean(await one("SELECT id FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo') LIMIT 1", [state.user.id]));
  state.hideStockInProductList = activeCount;
  return `<section class="page-head"><div><div class="eyebrow">CATÁLOGO LOCAL</div><h1>Productos</h1><p class="muted">Los productos y el stock se conservan en este teléfono.</p></div><span class="count-pill">${products.length} productos</span></section>
    <section class="panel"><div class="toolbar"><input id="products-search" placeholder="Buscar por nombre o código…"><button class="btn secondary" data-act="open-new-product">Nuevo producto</button></div>
    <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Código</th><th>Precio USD</th>${activeCount ? '' : '<th>Stock local</th>'}<th>Origen</th></tr></thead><tbody id="products-rows">${productRows(products, activeCount)}</tbody></table></div></section>`;
}

function productRows(products, hideStock = false) {
  if (!products.length) return `<tr><td colspan="${hideStock?4:5}" class="empty-cell">No hay productos importados.</td></tr>`;
  return products.map(product => `<tr><td><div class="table-product">${product.foto_base64 ? `<img src="data:image/jpeg;base64,${product.foto_base64}">` : '<span class="table-placeholder">CH</span>'}<strong>${esc(product.nombre)}</strong></div></td><td class="code-text">${esc(product.codigo)}</td><td>${formatUSD(product.precio_usd)}</td>${hideStock ? '' : `<td>${Number(product.stock)}</td>`}<td><span class="tag ${product.origen==='app'?'tag-new':'tag-catalog'}">${product.origen==='app'?'Nuevo/app':'Catálogo'}</span></td></tr>`).join('');
}

async function renderHistory() {
  const sales = await query('SELECT * FROM ventas WHERE jornada_id=? ORDER BY fecha_hora DESC', [state.day.id]);
  const entries = await Promise.all(sales.map(async sale => ({ sale, user: await one('SELECT nombre FROM usuarios WHERE id=?',[sale.dependiente_id]) })));
  return `<section class="page-head"><div><div class="eyebrow">ACTIVIDAD DEL DÍA</div><h1>Historial de ventas</h1><p class="muted">Consulta el detalle y registra anulaciones con autorización del administrador.</p></div></section>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Venta</th><th>Hora</th><th>Dependiente</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${entries.length ? entries.map(({sale,user}) => `<tr><td>#${sale.numero_local}</td><td>${localTime(sale.fecha_hora)}</td><td>${esc(user?.nombre || '')}</td><td>${formatUSD(sale.total_usd)}</td><td><span class="tag ${sale.estado==='cerrada'?'tag-ok':['anulada','cancelada'].includes(sale.estado)?'tag-danger':'tag-warn'}">${sale.estado}</span></td><td><button class="btn small secondary" data-act="sale-detail" data-id="${esc(sale.id)}">Detalle</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">No hay ventas en el historial de hoy.</td></tr>'}</tbody></table></div></section>`;
}

async function renderAdmin() {
  const pending = await one("SELECT COUNT(*) AS n FROM productos WHERE pendiente_sync=1");
  const closures = await query('SELECT * FROM cierres ORDER BY generado_en DESC LIMIT 8');
  const auditRows = await query('SELECT fecha_hora,usuario,accion,detalle FROM auditoria ORDER BY fecha_hora DESC LIMIT 250');
  const surcharge = Number(state.day.recargo_transferencia || 20);
  return `<section class="page-head"><div><div class="eyebrow">CONTROL DEL DUEÑO</div><h1>Administración</h1><p class="muted">Funciones sensibles protegidas por la sesión de administrador.</p></div><span class="admin-pill">ADMINISTRADOR</span></section>
    <div class="admin-grid">
      <section class="panel admin-card"><div class="admin-icon">⇧</div><h3>Importar catálogo</h3><p>Importa el ZIP preparado en la PC. Actualiza productos por código sin duplicarlos.</p><button class="btn primary" data-act="import-catalog">Seleccionar catálogo ZIP</button></section>
      <section class="panel admin-card"><div class="admin-icon">▤</div><h3>Respaldo completo</h3><p>Exporta productos, usuarios, ventas, pagos, cierres y auditoría.</p><button class="btn secondary" data-act="backup">Crear y compartir respaldo</button></section>
      <section class="panel admin-card"><div class="admin-icon">↻</div><h3>Restaurar respaldo</h3><p>Reemplaza los datos locales por un respaldo verificado.</p><button class="btn danger-outline" data-act="restore">Seleccionar respaldo</button></section>
      <section class="panel admin-card"><div class="admin-icon">♙</div><h3>Usuarios</h3><p>Gestiona los accesos de administrador y dependiente.</p><button class="btn secondary" data-act="manage-users">Gestionar usuarios</button></section>
      <section class="panel admin-card"><div class="admin-icon">≡</div><h3>Auditoría</h3><p>Consulta acciones sensibles, usuario responsable, fecha y detalle.</p><button class="btn secondary" data-go="auditoria">Ver auditoría</button></section>
      <section class="panel admin-card"><div class="admin-icon">₱</div><h3>Tasa del día</h3><p>Actual: <strong>${esc(state.day.tasa_cup)} CUP/USD</strong>. La corrección se aplica solo a ventas futuras.</p><button class="btn secondary" data-act="correct-rate">Corregir tasa del día</button></section>
      <section class="panel admin-card"><div class="admin-icon">%</div><h3>Recargo transferencia</h3><p>Porcentaje aplicado sobre la conversión CUP de la transferencia.</p><div class="inline-edit"><input id="surcharge-value" type="number" min="0" max="100" step="0.01" value="${surcharge}"><button class="btn secondary" data-act="save-surcharge">Guardar</button></div></section>
    </div>
    <section class="panel admin-foot"><div><strong>${pending?.n || 0} productos pendientes de sincronización</strong><small>Los productos creados desde el teléfono se incluirán en el cierre para incorporarlos al catálogo maestro.</small></div><div class="button-row"><button class="btn secondary" data-go="cierres">Historial de cierres</button><button class="btn primary" data-act="review-close-day">Cerrar día</button></div></section>
    <section class="panel"><div class="section-title"><h3>Últimos cierres</h3><button class="text-button" data-go="cierres">Ver todos</button></div>${closures.length ? closures.map(c => `<div class="closure-row"><div><strong>${esc(c.archivo_generado)}</strong><small>${esc(c.fecha)} · SHA-256 ${esc(c.hash).slice(0,18)}…</small></div><button class="btn small secondary" data-act="reshare-closure" data-id="${esc(c.id)}">Compartir</button></div>`).join('') : '<p class="muted">Todavía no hay cierres exportados.</p>'}</section>
    <section class="panel audit-panel"><div class="section-title"><h3>Auditoría reciente</h3><span class="count-pill">Últimos ${auditRows.length}</span></div>${auditRows.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>${auditRows.map(row => `<tr><td>${esc(new Date(row.fecha_hora).toLocaleString('es-CU'))}</td><td>${esc(row.usuario)}</td><td><span class="tag tag-catalog">${esc(row.accion)}</span></td><td class="audit-detail">${esc(String(row.detalle || '').slice(0,180))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Todavía no hay acciones registradas.</p>'}</section>`;
}


async function renderAuditLog() {
  const rows = await query('SELECT fecha_hora,usuario,accion,detalle FROM auditoria ORDER BY fecha_hora DESC LIMIT 250');
  return `<section class="page-head"><div><div class="eyebrow">CONTROL Y TRAZABILIDAD</div><h1>Auditoría</h1><p class="muted">Últimos 250 eventos locales. Los registros no se eliminan desde esta pantalla.</p></div><button class="btn secondary" data-go="admin">Volver</button></section>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>${rows.length ? rows.map(row => `<tr><td>${esc(new Date(row.fecha_hora).toLocaleString('es-CU'))}</td><td>${esc(row.usuario)}</td><td><span class="tag tag-catalog">${esc(row.accion)}</span></td><td class="audit-detail">${esc(row.detalle)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-cell">Todavía no hay eventos de auditoría.</td></tr>'}</tbody></table></div></section>`;
}

async function renderPayment() {
  if (!state.sale) { state.view = 'caja'; return renderCashier([], 0); }
  const totals = await getSaleTotals(state.sale.id);
  const pending = Math.max(0, totals.balance);
  const rate = Number(totals.sale.tasa_cup);
  const surcharge = Number(totals.sale.recargo_transf);
  const selectedRecommendation = recommendedAmount(state.paymentMethod, pending, rate, surcharge);
  if (!state.paymentValue && pending > 0) state.paymentValue = selectedRecommendation.toFixed(2);
  const paymentRows = totals.payments.map(payment => `<div class="payment-row ${payment.estado==='anulado'?'payment-voided':''}"><span>${payment.metodo==='USD'?'Efectivo USD':payment.metodo==='CUP'?'Efectivo CUP':'Transferencia'}${payment.estado==='anulado'?' · ANULADO':''}</span><small>${formatMoneyMethod(payment.monto_original,payment.moneda)}</small><strong>${formatUSD(payment.equivalente_usd)}</strong>${payment.estado!=='anulado' && ['abierta','pausada'].includes(totals.sale.estado) ? `<button class="payment-delete" data-act="delete-payment" data-id="${esc(payment.id)}" aria-label="Eliminar pago">⌫</button>` : ''}</div>`).join('');
  const done = totals.balance <= 0;
  const change = done ? totals.change : 0;
  const changeData = cashChange(change, state.changeCurrency, rate);
  return `<section class="page-head"><div><div class="eyebrow">COBRO · VENTA #${state.sale.numero_local}</div><h1>Completar pago</h1><p class="muted">Puedes combinar efectivo USD, efectivo CUP y transferencia.</p></div><div class="button-row"><button class="btn secondary" data-go="caja">Volver al carrito</button><button class="btn danger-outline" data-act="cancel-sale" data-id="${esc(state.sale.id)}">Eliminar venta</button></div></section>
    <div class="payment-grid">
      <section class="panel payment-main">
        <div class="payment-total"><div><small>TOTAL DE LA VENTA</small><strong>${formatUSD(totals.total)}</strong></div><div class="balance-box ${done?'complete':''}"><small>${done?'ESTADO':'FALTA'}</small><strong>${done?'LISTO':formatUSD(pending)}</strong></div></div>
        <div class="method-tabs">
          <button class="method-tab ${state.paymentMethod==='USD'?'active':''}" data-act="select-method" data-method="USD">USD efectivo</button>
          <button class="method-tab ${state.paymentMethod==='CUP'?'active':''}" data-act="select-method" data-method="CUP">CUP efectivo</button>
          <button class="method-tab ${state.paymentMethod==='TRANSFER'?'active':''}" data-act="select-method" data-method="TRANSFER">Transferencia</button>
        </div>
        <div class="method-info">${state.paymentMethod==='TRANSFER' ? `Transferir ahora: <strong>${formatCUP(selectedRecommendation)}</strong> (incluye ${surcharge}% de recargo).` : state.paymentMethod==='CUP' ? `Equivalente recomendado: <strong>${formatCUP(selectedRecommendation)}</strong> a ${rate} CUP/USD.` : `Efectivo USD recomendado: <strong>${formatUSD(selectedRecommendation)}</strong>.`}</div>
        <label class="amount-label">Monto recibido (${state.paymentMethod==='USD'?'USD':'CUP'})
          <input id="payment-value" class="amount-display" value="${esc(state.paymentValue || (pending>0?String(selectedRecommendation.toFixed(2)):''))}" readonly placeholder="0.00">
        </label>
        <div class="num-pad">${['1','2','3','4','5','6','7','8','9','00','0','.','BORRAR','⌫'].map(key => `<button data-act="num-key" data-key="${key}">${key}</button>`).join('')}</div>
        <button class="btn primary wide payment-submit" data-act="register-payment" ${done?'disabled':''}>Registrar este pago</button>
        ${done ? `<div class="change-panel"><div><small>VUELTO</small><strong>${formatUSD(change)}</strong></div><div class="change-options"><button class="${state.changeCurrency==='USD'?'selected':''}" data-act="change-currency" data-currency="USD">USD · ${formatUSD(changeData.amount)}</button><button class="${state.changeCurrency==='CUP'?'selected':''}" data-act="change-currency" data-currency="CUP">CUP · ${formatCUP(cashChange(change,'CUP',rate).amount)}</button></div><button class="btn primary wide" data-act="finish-sale">Cerrar venta y descontar stock</button></div>` : ''}
      </section>
      <aside class="panel payment-summary"><h3>Pagos registrados</h3>${paymentRows || '<p class="muted">Aún no se han registrado pagos.</p>'}<div class="payment-summary-total"><span>Abonado en USD equivalente</span><strong>${formatUSD(totals.paid)}</strong></div><div class="rate-note">Tasa guardada en esta venta: ${rate} CUP/USD · Recargo: ${surcharge}%</div></aside>
    </div>`;
}

function formatMoneyMethod(amount, currency) {
  return currency === 'USD' ? formatUSD(amount) : formatCUP(amount);
}

async function renderClosures() {
  const closures = await query('SELECT * FROM cierres ORDER BY generado_en DESC');
  return `<section class="page-head"><div><div class="eyebrow">ARCHIVOS DE CAJA</div><h1>Cierres diarios</h1><p class="muted">Los cierres quedan guardados para volver a compartirlos.</p></div></section>
    <section class="panel"><div class="section-title"><h3>Historial de cierres</h3><button class="btn secondary" data-go="admin">Volver</button></div>
    ${closures.length ? closures.map(c => `<div class="closure-row"><div><strong>${esc(c.archivo_generado)}</strong><small>${esc(c.fecha)} · SHA-256 ${esc(c.hash)}</small></div><button class="btn small secondary" data-act="reshare-closure" data-id="${esc(c.id)}">Compartir de nuevo</button></div>`).join('') : '<p class="muted">No hay cierres guardados.</p>'}</section>`;
}

function bindShell() {
  root.querySelector('#inventory-entry-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await runExclusive('inventory-entry', registerInventoryEntry); } catch (error) { notify(error.message || 'No se pudo registrar la entrada.', 'error'); }
  });
  root.querySelector('#inventory-exit-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    try { await runExclusive('inventory-exit', registerInventoryExit); } catch (error) { notify(error.message || 'No se pudo registrar la salida.', 'error'); }
  });
  root.onclick = async event => {
    const button = event.target.closest('button[data-act],button[data-go]');
    if (!button) return;
    const action = button.dataset.act;
    const go = button.dataset.go;
    if (go) {
      state.view = go;
      if (go === 'cobro' && !state.sale) state.view = 'caja';
      state.product = null;
      await renderShell();
      return;
    }
    try {
      switch (action) {
        case 'logout':
          if (state.turn) return notify('Cierra tu turno antes de salir.', 'warning');
          state.user = null; state.day = null; state.turn = null; state.sale = null; state.product = null;
          renderLogin(await query("SELECT * FROM usuarios WHERE activo=1 ORDER BY CASE rol WHEN 'administrador' THEN 0 ELSE 1 END, creado_en")); break;
        case 'close-turn': await closeCurrentTurn(); break;
        case 'manual-scan': {
          const input = document.querySelector('#manual-code');
          const code = input?.value.trim();
          if (code) await handleBarcode(code);
          break;
        }
        case 'qty-minus': state.productQty = Math.max(1, state.productQty - 1); await renderShell(); break;
        case 'qty-plus': state.productQty = Math.min(9999, state.productQty + 1); await renderShell(); break;
        case 'add-product': await addCurrentProduct(); break;
        case 'new-sale': await createSale(); break;
        case 'pause-sale': await runExclusive(`pause:${state.sale?.id}`, pauseCurrentSale); break;
        case 'resume-sale': await runExclusive(`resume:${button.dataset.id}`, () => resumeSale(button.dataset.id)); break;
        case 'line-minus': await changeLineQuantity(button.dataset.id, -1); break;
        case 'line-plus': await changeLineQuantity(button.dataset.id, 1); break;
        case 'line-remove': await removeLine(button.dataset.id); break;
        case 'go-payment':
          if (!state.sale) return;
          state.paymentMethod = 'USD'; state.paymentValue = '';
          state.view = 'cobro'; await renderShell(); break;
        case 'select-method':
          state.paymentMethod = button.dataset.method; state.paymentValue = '';
          await renderShell(); break;
        case 'num-key': handleNumKey(button.dataset.key); break;
        case 'register-payment': await runExclusive(`payment:${state.sale?.id}`, registerPayment); break;
        case 'delete-payment': await runExclusive(`delete-payment:${button.dataset.id}`, () => deletePayment(button.dataset.id)); break;
        case 'cancel-sale': await runExclusive(`cancel-sale:${button.dataset.id || state.sale?.id}`, () => cancelSale(button.dataset.id || state.sale?.id)); break;
        case 'change-currency': state.changeCurrency = button.dataset.currency; await renderShell(); break;
        case 'finish-sale': await runExclusive(`finish:${state.sale?.id}`, finishSale); break;
        case 'open-new-product': state.pendingCode = ''; state.view = 'productos'; await openNewProductModal(); break;
        case 'import-catalog': await importCatalog(); break;
        case 'confirm-import': await confirmCatalogImport(); break;
        case 'confirm-restore': await confirmRestoreBackup(); break;
        case 'backup': await createBackup(); break;
        case 'restore': await restoreBackup(); break;
        case 'manage-users': await openUsersModal(); break;
        case 'toggle-user': await toggleUserStatus(button.dataset.id); break;
        case 'change-user-pin': await changeUserPin(button.dataset.id); break;
        case 'correct-rate': await openRateCorrectionModal(); break;
        case 'save-surcharge': await saveSurcharge(); break;
        case 'refresh-audit': state.view = 'auditoria'; await renderShell(); break;
        case 'inventory-entry': await registerInventoryEntry(); break;
        case 'inventory-add-count': await addInventoryCountItem(); break;
        case 'confirm-missing-counts': await confirmMissingInventoryCounts(); break;
        case 'inventory-exit': await registerInventoryExit(); break;
        case 'inventory-confirm-entry': await confirmInventoryEntry(button.dataset.id); break;
        case 'inventory-start-count': await startInventoryCount(); break;
        case 'inventory-submit-count': await submitInventoryCount(); break;
        case 'inventory-recount': await submitInventoryRecount(); break;
        case 'inventory-review-accept': await reviewInventoryCount(button.dataset.id, 'aceptar'); break;
        case 'inventory-review-keep': await reviewInventoryCount(button.dataset.id, 'mantener'); break;
        case 'inventory-review-recount': await reviewInventoryCount(button.dataset.id, 'recontar'); break;
        case 'sale-detail': await showSaleDetail(button.dataset.id); break;
        case 'annul-line': await runExclusive(`annul-line:${button.dataset.id}`, () => annulLine(button.dataset.id)); break;
        case 'annul-sale': await runExclusive(`annul-sale:${button.dataset.id}`, () => annulSale(button.dataset.id)); break;
        case 'reshare-closure': await reshareClosure(button.dataset.id); break;
        case 'close-day': await closeDayAndShare(); break;
        case 'review-close-day': await showDayClosePreview(); break;
        case 'confirm-close-day': await closeDayAndShare(); break;
        case 'modal-close': closeModal(); break;
      }
    } catch (error) {
      console.error(error);
      notify(error.message || 'Ocurrió un error.', 'error');
    }
  };
  root.oninput = event => {
    if (event.target.id === 'products-search') filterProducts(event.target.value);
    if (event.target.id === 'product-qty') {
      const quantity = Number(event.target.value);
      state.productQty = Number.isInteger(quantity) && quantity >= 1 && quantity <= 9999 ? quantity : 0;
    }
  };
}

async function handleBarcode(code) {
  if (!state.user || !['caja','inventario'].includes(state.view)) return;
  if (state.view === 'inventario') {
    const focused = document.activeElement?.matches?.('#count-code,#inventory-exit-code,#inventory-code') ? document.activeElement : null;
    const codeInput = focused || document.querySelector('#count-code') || document.querySelector('#inventory-exit-code') || document.querySelector('#inventory-code');
    if (codeInput) { codeInput.value = String(code).trim(); codeInput.dispatchEvent(new Event('input', { bubbles: true })); beep(); return; }
    return;
  }
  beep();
  if (!state.sale) await createSale();
  const product = await one('SELECT * FROM productos WHERE codigo=?', [String(code).trim()]);
  state.productQty = 1;
  if (!product) {
    state.pendingCode = String(code).trim();
    await renderShell();
    await showUnknownCodeModal(state.pendingCode);
    return;
  }
  state.product = product;
  await renderShell();
}

async function createSale() {
  if (!state.turn || state.turn.usuario_id !== state.user?.id) return notify('Debes abrir tu turno antes de registrar una venta.', 'warning');
  if (state.sale) {
    const lines = await getSaleLines(state.sale.id);
    if (lines.length) return notify('Termina o pausa la venta actual antes de abrir otra.', 'warning');
    return notify('Ya existe una venta abierta.', 'warning');
  }
  const last = await one('SELECT COALESCE(MAX(numero_local),0) AS n FROM ventas WHERE jornada_id=?', [state.day.id]);
  const sale = {
    id: id(), numero_local: Number(last?.n || 0) + 1, jornada_id: state.day.id,
    fecha_hora: localDateTime(), dependiente_id: state.user.id, turno_id: state.turn.id, estado: 'abierta',
    total_usd: 0, tasa_cup: state.day.tasa_cup, recargo_transf: state.day.recargo_transferencia
  };
  await run(`INSERT INTO ventas(id,numero_local,jornada_id,fecha_hora,dependiente_id,turno_id,estado,total_usd,tasa_cup,recargo_transf)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, [sale.id,sale.numero_local,sale.jornada_id,sale.fecha_hora,sale.dependiente_id,sale.turno_id,sale.estado,sale.total_usd,sale.tasa_cup,sale.recargo_transf]);
  state.sale = sale;
  state.product = null;
  state.view = 'caja';
  await renderShell();
}

async function updateSaleTotal(saleId) {
  const lines = await getSaleLines(saleId);
  const total = calculateCartTotal(lines);
  await run('UPDATE ventas SET total_usd=? WHERE id=?', [total,saleId]);
  if (state.sale?.id === saleId) state.sale.total_usd = total;
  return total;
}

async function addCurrentProduct() {
  if (!state.product || !state.sale) return;
  if (!Number.isInteger(state.productQty) || state.productQty < 1 || state.productQty > 9999) {
    return notify('Introduce una cantidad entera entre 1 y 9999.', 'error');
  }
  const blindCount = state.user.rol === 'dependiente' && Boolean(await one("SELECT id FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo') LIMIT 1", [state.user.id]));
  if (!blindCount && Number(state.product.stock) < state.productQty) {
    const allow = window.confirm(`Stock disponible: ${state.product.stock}. Vas a añadir ${state.productQty}. ¿Continuar de todos modos?`);
    if (!allow) return;
  }
  const existing = await one('SELECT * FROM lineas_venta WHERE venta_id=? AND codigo=? AND anulada=0', [state.sale.id,state.product.codigo]);
  if (existing) {
    await run('UPDATE lineas_venta SET cantidad=cantidad+? WHERE id=?', [state.productQty,existing.id]);
  } else {
    await run(`INSERT INTO lineas_venta(id,venta_id,codigo,nombre_snapshot,precio_snapshot,cantidad,anulada)
      VALUES(?,?,?,?,?,?,0)`, [id(),state.sale.id,state.product.codigo,state.product.nombre,state.product.precio_usd,state.productQty]);
  }
  await updateSaleTotal(state.sale.id);
  state.product = null; state.productQty = 1;
  await renderShell();
}

async function changeLineQuantity(lineId, delta) {
  const line = await one('SELECT * FROM lineas_venta WHERE id=?', [lineId]);
  if (!line || !state.sale || line.venta_id !== state.sale.id) return;
  const next = Number(line.cantidad) + delta;
  if (next < 1) return;
  const blindCount = state.user.rol === 'dependiente' && Boolean(await one("SELECT id FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo') LIMIT 1", [state.user.id]));
  const product = await one('SELECT stock FROM productos WHERE codigo=?', [line.codigo]);
  if (!blindCount && delta > 0 && Number(product?.stock ?? 0) < next) {
    if (!window.confirm(`Stock disponible: ${product?.stock ?? 0}. ¿Mantener la cantidad ${next}?`)) return;
  }
  await run('UPDATE lineas_venta SET cantidad=? WHERE id=?', [next,lineId]);
  await updateSaleTotal(state.sale.id);
  await renderShell();
}

async function removeLine(lineId) {
  if (!window.confirm('¿Eliminar este producto del carrito?')) return;
  await run('DELETE FROM lineas_venta WHERE id=? AND venta_id=?', [lineId,state.sale.id]);
  await updateSaleTotal(state.sale.id);
  await renderShell();
}

async function pauseCurrentSale() {
  if (!state.sale) return;
  const paused = await run("UPDATE ventas SET estado='pausada' WHERE id=? AND estado='abierta'", [state.sale.id]);
  if (Number(paused?.changes || 0) !== 1) throw new Error('La venta ya no está abierta para pausarla.');
  await audit(state.user, 'pausar_venta', { venta: state.sale.id });
  state.sale = null; state.product = null;
  await renderShell();
  notify('Venta pausada. Puedes retomarla desde la lista.', 'success');
}

async function resumeSale(saleId) {
  if (state.sale) return notify('Pausa la venta activa antes de retomar otra.', 'warning');
  const sale = await one("SELECT * FROM ventas WHERE id=? AND estado='pausada' AND jornada_id=? AND turno_id=? AND dependiente_id=?", [saleId,state.day.id,state.turn?.id,state.user.id]);
  if (!sale) return notify('La venta pausada ya no está disponible.', 'error');
  const resumed = await run("UPDATE ventas SET estado='abierta' WHERE id=? AND estado='pausada'", [saleId]);
  if (Number(resumed?.changes || 0) !== 1) throw new Error('La venta ya no está pausada.');
  state.sale = { ...sale, estado: 'abierta' };
  state.view = 'caja';
  await audit(state.user, 'retomar_venta', { venta: saleId });
  await renderShell();
}

async function closeCurrentTurn() {
  if (!state.turn) {
    state.user = null; state.day = null; state.sale = null; state.product = null;
    return renderLogin(await query("SELECT * FROM usuarios WHERE activo=1 ORDER BY CASE rol WHEN 'administrador' THEN 0 ELSE 1 END, creado_en"));
  }
  const unfinished = await one("SELECT COUNT(*) AS n FROM ventas WHERE turno_id=? AND estado IN ('abierta','pausada')", [state.turn.id]);
  if (Number(unfinished?.n || 0) > 0) {
    throw new Error('Antes de cerrar tu turno debes terminar o eliminar todas tus ventas abiertas o pausadas.');
  }
  const activeCount = await one("SELECT COUNT(*) AS n FROM conteos WHERE usuario_id=? AND estado IN ('en_curso','reconteo')", [state.user.id]);
  if (Number(activeCount?.n || 0) > 0) throw new Error('Antes de cerrar el turno debes terminar el conteo de inventario que tienes abierto.');
  const turnId = state.turn.id;
  const closedAt = localDateTime();
  await transaction(async () => {
    const result = await run('UPDATE turnos SET fin=? WHERE id=? AND fin IS NULL', [closedAt, turnId]);
    if (Number(result?.changes || 0) !== 1) throw new Error('El turno ya estaba cerrado.');
    await audit(state.user, 'cierre_turno', { turno_id: turnId, fin: closedAt });
  });
  state.turn = null; state.user = null; state.sale = null; state.product = null; state.day = null;
  renderLogin(await query("SELECT * FROM usuarios WHERE activo=1 ORDER BY CASE rol WHEN 'administrador' THEN 0 ELSE 1 END, creado_en"));
  notify('Turno cerrado correctamente.', 'success');
}

async function deletePayment(paymentId) {
  const payment = await one('SELECT * FROM pagos WHERE id=?', [paymentId]);
  if (!payment) throw new Error('No se encontró el pago.');
  const sale = await one('SELECT * FROM ventas WHERE id=?', [payment.venta_id]);
  if (!sale || !['abierta','pausada'].includes(sale.estado)) throw new Error('Solo se pueden eliminar pagos de ventas abiertas o pausadas.');
  if ((payment.estado || 'activo') !== 'activo') return notify('Este pago ya está anulado.', 'warning');
  const methodLabel = payment.metodo === 'USD' ? 'Efectivo USD' : payment.metodo === 'CUP' ? 'Efectivo CUP' : 'Transferencia';
  const amountLabel = formatMoneyMethod(payment.monto_original, payment.moneda);
  if (!window.confirm(`¿Eliminar este pago?\n\n${methodLabel}: ${amountLabel}\n\nDejará de contar y el saldo de la venta se recalculará automáticamente. La operación quedará registrada en auditoría.`)) return;
  await transaction(async () => {
    const changed = await run("UPDATE pagos SET estado='anulado',anulado_por=?,anulado_en=? WHERE id=? AND estado='activo'", [state.user.id, localDateTime(), paymentId]);
    if (Number(changed?.changes || 0) !== 1) throw new Error('El pago cambió de estado y no pudo eliminarse.');
    await audit(state.user, 'pago_anulado', { venta_id: sale.id, pago_id: paymentId, metodo: payment.metodo, importe: payment.monto_original, moneda: payment.moneda });
  });
  const totals = await getSaleTotals(sale.id);
  if (state.sale?.id === sale.id) state.sale = { ...state.sale, total_usd: totals.total };
  await renderShell();
  notify('Pago eliminado. El saldo se actualizó.', 'success');
}

async function cancelSale(saleId) {
  if (!saleId) return;
  const sale = await one('SELECT * FROM ventas WHERE id=?', [saleId]);
  if (!sale || !['abierta','pausada'].includes(sale.estado)) throw new Error('Solo se pueden eliminar ventas abiertas o pausadas.');
  const lines = await getSaleLines(saleId);
  const payments = await getSalePayments(saleId);
  const activeCount = payments.filter(payment => (payment.estado || 'activo') === 'activo').length;
  const message = `¿Eliminar esta venta?\n\nVenta #${sale.numero_local}\nProductos: ${lines.length}\nPagos que dejarán de contar: ${activeCount}\n\nNo se modificará el inventario. La venta y sus líneas quedarán conservadas y la cancelación se registrará en auditoría.`;
  if (!window.confirm(message)) return;
  await transaction(async () => {
    const changed = await run("UPDATE ventas SET estado='cancelada' WHERE id=? AND estado IN ('abierta','pausada')", [saleId]);
    if (Number(changed?.changes || 0) !== 1) throw new Error('La venta ya cambió de estado.');
    await run("UPDATE pagos SET estado='anulado',anulado_por=?,anulado_en=? WHERE venta_id=? AND estado='activo'", [state.user.id, localDateTime(), saleId]);
    await audit(state.user, 'venta_cancelada', { venta_id: saleId, numero_local: sale.numero_local, total_usd: sale.total_usd, pagos_anulados: activeCount });
  });
  if (state.sale?.id === saleId) { state.sale = null; state.product = null; state.view = 'caja'; }
  if (state.currentDetail === saleId) state.currentDetail = null;
  await renderShell();
  notify('Venta cancelada. Se conservó el historial y no se tocó el inventario.', 'success');
}

function handleNumKey(key) {
  if (key === 'BORRAR') state.paymentValue = '';
  else if (key === '⌫') state.paymentValue = state.paymentValue.slice(0,-1);
  else if (key === '.') {
    if (!state.paymentValue.includes('.')) state.paymentValue = (state.paymentValue || '0') + '.';
  } else {
    if (state.paymentValue.length >= 12) return;
    const fractional = state.paymentValue.split('.')[1] || '';
    const addedDigits = String(key).replace(/\D/g, '').length;
    if (state.paymentValue.includes('.') && fractional.length + addedDigits > 2) return;
    state.paymentValue += key;
  }
  const input = document.querySelector('#payment-value');
  if (input) input.value = state.paymentValue;
}

async function registerPayment() {
  if (!state.sale) return;
  const saleId = state.sale.id;
  const amount = moneyInput(state.paymentValue);
  if (!Number.isFinite(amount) || amount <= 0) return notify('Introduce un monto mayor que cero.', 'error');
  await transaction(async () => {
    const totals = await getSaleTotals(saleId);
    if (!totals.sale || totals.sale.estado !== 'abierta') throw new Error('La venta ya no está abierta para recibir pagos.');
    if (totals.balance <= 0) throw new Error('El pago ya está completo.');
    const entry = buildPaymentRecord({
      method: state.paymentMethod,
      amount,
      rate: totals.sale.tasa_cup,
      surchargePercent: totals.sale.recargo_transf,
      dateTime: localDateTime()
    });
    await run(`INSERT INTO pagos(id,venta_id,metodo,monto_original,moneda,tasa_aplicada,equivalente_usd,fecha_hora,estado,turno_id)
      VALUES(?,?,?,?,?,?,?,?,'activo',?)`, [id(),saleId,entry.metodo,entry.monto_original,entry.moneda,entry.tasa_aplicada,entry.equivalente_usd,entry.fecha_hora,state.turn?.id || null]);
    await audit(state.user, 'registrar_pago', {
      venta: saleId, metodo: entry.metodo, monto: entry.monto_original,
      moneda: entry.moneda, equivalente_usd: entry.equivalente_usd
    });
  });
  state.paymentValue = '';
  const after = await getSaleTotals(saleId);
  if (after.balance <= 0) notify('Pago completado. Selecciona la moneda del vuelto y cierra la venta.', 'success');
  else notify(`Pago registrado. Falta ${formatUSD(after.balance)}.`, 'info');
  await renderShell();
}

async function finishSale() {
  if (!state.sale) return;
  const saleId = state.sale.id;
  await transaction(async () => {
    const totals = await getSaleTotals(saleId);
    if (!totals.sale || totals.sale.estado !== 'abierta') throw new Error('La venta ya no está abierta.');
    if (!totals.isPaid) throw new Error(`No puedes cerrar la venta. Falta ${formatUSD(totals.balance)}.`);
    const changeInfo = buildChangeRecord(totals.change, state.changeCurrency, Number(totals.sale.tasa_cup));
    const closed = await run("UPDATE ventas SET estado='cerrada', vuelto_moneda=?, vuelto_monto=? WHERE id=? AND estado='abierta'",
      [changeInfo.moneda, changeInfo.monto, saleId]);
    if (Number(closed?.changes || 0) !== 1) throw new Error('La venta ya fue cerrada por otra operación.');
    for (const line of stockToDeduct(totals.lines)) {
      await run('UPDATE productos SET stock=stock-?, actualizado_en=? WHERE codigo=?', [line.cantidad,localDateTime(),line.codigo]);
    }
    await audit(state.user, 'cerrar_venta', {
      venta: saleId, total_usd: totals.total, pagado_usd: totals.paid, vuelto: changeInfo
    });
  });
  state.sale = null; state.product = null; state.view = 'caja';
  await renderShell();
  notify('Venta cerrada. El stock local fue actualizado.', 'success');
}

function setModal(content) {
  setScannerEnabled(false);
  const host = document.querySelector('#modal-root');
  if (host) host.innerHTML = `<div class="modal-backdrop"><section class="modal-card">${content}</section></div>`;
}
function closeModal() {
  const host = document.querySelector('#modal-root');
  if (host) host.innerHTML = '';
  setScannerEnabled(['caja','inventario'].includes(state.view) && Boolean(state.user) && !state.product);
  monitorScannerStatus();
}


async function showUnknownCodeModal(code) {
  setModal(`<div class="modal-head"><span class="eyebrow">PRODUCTO NO ENCONTRADO</span><button class="icon-close" data-act="modal-close">×</button></div><h2>Código no registrado</h2><p>No existe un producto con el código <strong class="code-text">${esc(code)}</strong> en el catálogo local.</p><div class="modal-actions"><button class="btn secondary" data-act="modal-close">Volver</button><button class="btn primary" data-act="create-unknown-product">Crear producto</button></div>`);
  document.querySelector('#modal-root').querySelector('[data-act="create-unknown-product"]').onclick = async () => { closeModal(); await openNewProductModal(code); };
  document.querySelector('#modal-root').querySelectorAll('[data-act="modal-close"]').forEach(btn => btn.onclick = closeModal);
}

async function openNewProductModal(prefillCode = '') {
  state.photoBase64 = '';
  setModal(`<div class="modal-head"><span class="eyebrow">ALTA DE PRODUCTO</span><button class="icon-close" data-act="modal-close">×</button></div><h2>Nuevo producto</h2><form id="new-product-form" class="form-grid">
    <label>Código / ID<input name="code" value="${esc(prefillCode || state.pendingCode)}" required maxlength="80" autocomplete="off"></label>
    <label>Nombre<input name="name" required maxlength="120"></label>
    <div class="two-cols"><label>Precio USD<input name="price" type="number" min="0" step="0.01" required></label><label>Stock inicial<input name="stock" type="number" step="1" min="0" value="0" required></label></div>
    <div class="photo-picker"><div id="photo-preview" class="photo-preview">CH</div><div><strong>Fotografía</strong><small>Se comprime aproximadamente a 30 KB.</small><button type="button" class="btn secondary small" id="take-photo">Cámara / Galería</button></div></div>
    <label>PIN de dependiente autorizado o administrador<input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="8" required></label>
    <div class="modal-actions"><button type="button" class="btn secondary" data-act="modal-close">Cancelar</button><button type="submit" class="btn primary">Guardar producto</button></div>
  </form>`);
  const host = document.querySelector('#modal-root');
  host.querySelectorAll('[data-act="modal-close"]').forEach(btn => btn.onclick = () => { state.pendingInventoryEntry = null; closeModal(); });
  host.querySelector('#take-photo').onclick = async () => {
    try {
      state.photoBase64 = await takeProductPhoto();
      host.querySelector('#photo-preview').innerHTML = `<img src="data:image/jpeg;base64,${state.photoBase64}" alt="Foto del producto">`;
    } catch (error) { notify(error.message, 'error'); }
  };
  host.querySelector('#new-product-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get('code')).trim();
    const name = String(form.get('name')).trim();
    const price = moneyInput(form.get('price'));
    const stock = Number(form.get('stock'));
    if (!code || !name || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) return notify('Revisa los campos del producto.', 'error');
    const exists = await one('SELECT codigo FROM productos WHERE codigo=?', [code]);
    if (exists) return notify('Ya existe un producto con ese código.', 'error');
    const authorized = await verifyAnyUserPin(String(form.get('pin')));
    if (!authorized) return notify('PIN no autorizado.', 'error');
    await run(`INSERT INTO productos(codigo,nombre,precio_usd,stock,stock_inicial,foto_base64,origen,pendiente_sync,actualizado_en,creado_en,creado_por)
      VALUES(?,?,?,?,?,?,'app',1,?,?,?)`, [code,name,roundMoney(price),stock,stock,state.photoBase64 || null,localDateTime(),localDateTime(),authorized.id]);
    await audit(authorized, 'crear_producto', { codigo: code, nombre: name, precio_usd: price, stock, autorizado_por: authorized.nombre });
    const created = await one('SELECT * FROM productos WHERE codigo=?', [code]);
    const pendingEntry = state.pendingInventoryEntry?.code === code ? state.pendingInventoryEntry : null;
    state.pendingInventoryEntry = null;
    const fromCashier = state.view === 'caja' || Boolean(state.pendingCode);
    closeModal();
    state.pendingCode = '';
    if (pendingEntry) {
      const movementId = id();
      await transaction(async () => {
        const beforeStock = Number(created.stock); const afterStock = beforeStock + pendingEntry.quantity;
        await run('UPDATE productos SET stock=stock+?,actualizado_en=? WHERE codigo=?', [pendingEntry.quantity,localDateTime(),code]);
        await run(`INSERT INTO movimientos_inventario(id,tipo,codigo,cantidad,fecha_hora,usuario_id,usuario,turno_id,motivo,nota,estado,movimiento_origen,stock_antes,stock_despues)
          VALUES(?,'entrada',?,?,?,?,?,?,?,?,'pendiente_confirmacion',NULL,?,?)`, [movementId,code,pendingEntry.quantity,localDateTime(),state.user.id,state.user.nombre,state.turn?.id||null,'entrada inicial',pendingEntry.note,beforeStock,afterStock]);
        await audit(state.user, 'entrada_inventario', { movimiento_id: movementId, codigo: code, cantidad: pendingEntry.quantity, nota: pendingEntry.note, producto_nuevo: true });
      });
      state.view = 'inventario';
    } else if (fromCashier) {
      state.view = 'caja'; state.product = created; state.productQty = 1;
    }
    await renderShell();
    notify(pendingEntry ? 'Producto creado y entrada registrada; queda pendiente de confirmación.' : 'Producto creado y marcado para sincronización con la PC.', 'success');
  };
}

async function pinAlreadyInUse(pin, excludeUserId = null) {
  const users = await query('SELECT id,pin_hash FROM usuarios');
  for (const user of users) {
    if (excludeUserId && user.id === excludeUserId) continue;
    if (await verifyPin(pin, user.pin_hash)) return true;
  }
  return false;
}

async function verifyAnyUserPin(pin) {
  const users = await query('SELECT * FROM usuarios WHERE activo=1');
  for (const user of users) if (await verifyPin(pin, user.pin_hash)) return user;
  return null;
}

async function requestAdminPin(actionDescription = 'autorizar esta operación') {
  const admins = await query("SELECT * FROM usuarios WHERE activo=1 AND rol='administrador'");
  if (!admins.length) throw new Error('No existe un administrador activo.');
  return new Promise(resolve => {
    setModal(`<div class="modal-head"><span class="eyebrow">AUTORIZACIÓN DEL DUEÑO</span><button class="icon-close" id="pin-cancel">×</button></div><h2>PIN de administrador</h2><p>${esc(actionDescription)} requiere autorización del dueño.</p><form id="admin-pin-form" class="form-grid"><label>PIN<input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="8" required autofocus></label><div class="modal-actions"><button type="button" class="btn secondary" id="pin-cancel-2">Cancelar</button><button class="btn primary" type="submit">Autorizar</button></div></form>`);
    const host = document.querySelector('#modal-root');
    const cancel = () => { closeModal(); resolve(null); };
    host.querySelector('#pin-cancel').onclick = cancel;
    host.querySelector('#pin-cancel-2').onclick = cancel;
    host.querySelector('#admin-pin-form').onsubmit = async event => {
      event.preventDefault();
      const pin = new FormData(event.currentTarget).get('pin');
      for (const admin of admins) {
        if (await verifyPin(pin, admin.pin_hash)) { closeModal(); resolve(admin); return; }
      }
      notify('PIN de administrador incorrecto.', 'error');
      host.querySelector('input[name="pin"]').value = '';
    };
  });
}

async function openRateCorrectionModal() {
  const admin = await requestAdminPin('Corregir la tasa CUP/USD');
  if (!admin) return;
  setModal(`<div class="modal-head"><span class="eyebrow">CORRECCIÓN ADMINISTRATIVA</span><button class="icon-close" data-act="modal-close">×</button></div><h2>Corregir tasa del día</h2><p>La tasa nueva se utilizará solo en ventas que se creen después de esta corrección. Las ventas existentes conservan su tasa original.</p><form id="rate-form" class="form-grid"><label>Nueva tasa (CUP por 1 USD)<input name="rate" type="number" min="0.01" step="0.01" value="${esc(state.day.tasa_cup)}" required></label><div class="modal-actions"><button type="button" class="btn secondary" data-act="modal-close">Cancelar</button><button type="submit" class="btn primary">Guardar corrección</button></div></form>`);
  const host = document.querySelector('#modal-root');
  host.querySelectorAll('[data-act="modal-close"]').forEach(btn => btn.onclick = closeModal);
  host.querySelector('#rate-form').onsubmit = async event => {
    event.preventDefault();
    const rate = moneyInput(new FormData(event.currentTarget).get('rate'));
    if (!Number.isFinite(rate) || rate <= 0) return notify('La tasa debe ser mayor que cero.', 'error');
    const old = state.day.tasa_cup;
    await run('UPDATE jornadas SET tasa_cup=? WHERE id=?', [rate,state.day.id]);
    await setConfig('tasa_cup', rate);
    state.day.tasa_cup = rate;
    await audit(admin, 'corregir_tasa', { anterior: old, nueva: rate, afecta: 'ventas futuras' });
    closeModal(); await renderShell(); notify('Tasa corregida. Las ventas anteriores no cambian.', 'success');
  };
}

async function saveSurcharge() {
  const percent = moneyInput(document.querySelector('#surcharge-value')?.value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return notify('El recargo debe estar entre 0 y 100%.', 'error');
  const admin = await requestAdminPin('Cambiar el recargo de transferencia');
  if (!admin) return;
  const previous = Number(state.day.recargo_transferencia);
  await run('UPDATE jornadas SET recargo_transferencia=? WHERE id=?', [percent,state.day.id]);
  await setConfig('recargo_transferencia', percent);
  state.day.recargo_transferencia = percent;
  await audit(admin, 'cambiar_recargo_transferencia', { anterior: previous, nuevo: percent, afecta: 'ventas futuras' });
  await renderShell(); notify('Recargo actualizado para las ventas nuevas.', 'success');
}

async function openUsersModal() {
  const users = await query('SELECT id,nombre,rol,activo FROM usuarios ORDER BY rol,nombre');
  setModal(`<div class="modal-head"><span class="eyebrow">ACCESOS</span><button class="icon-close" data-act="modal-close">×</button></div><h2>Usuarios</h2>
    <div class="user-list">${users.map(user => `<div class="user-row"><div><strong>${esc(user.nombre)}</strong><small>${user.rol==='administrador'?'Administrador':'Dependiente'} · ${user.activo?'Activo':'Inactivo'}</small></div><div class="user-actions"><button class="btn small secondary" data-act="change-user-pin" data-id="${esc(user.id)}">Cambiar PIN</button><button class="btn small ${user.activo?'danger-outline':'secondary'}" data-act="toggle-user" data-id="${esc(user.id)}">${user.activo?'Desactivar':'Activar'}</button></div></div>`).join('')}</div>
    <h3>Crear usuario</h3><form id="new-user-form" class="form-grid"><label>Nombre<input name="name" required maxlength="60"></label><label>Rol<select name="role"><option value="dependiente">Dependiente</option><option value="administrador">Administrador</option></select></label><label>PIN nuevo<input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required></label><label>PIN actual del administrador<input name="adminPin" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required></label><div class="modal-actions"><button type="button" class="btn secondary" data-act="modal-close">Cerrar</button><button type="submit" class="btn primary">Crear usuario</button></div></form>`);
  const host = document.querySelector('#modal-root');
  host.querySelectorAll('[data-act="modal-close"]').forEach(btn => btn.onclick = closeModal);
  host.querySelector('#new-user-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const role = String(form.get('role'));
    const pin = String(form.get('pin'));
    const pinOwner = await verifyAnyUserPin(String(form.get('adminPin')));
    if (!pinOwner || pinOwner.rol !== 'administrador') return notify('PIN de administrador incorrecto.', 'error');
    if (!name || !['dependiente','administrador'].includes(role)) return notify('Revisa el nombre y el rol.', 'error');
    if (await pinAlreadyInUse(pin)) return notify('Ese PIN ya está asignado a otro usuario. Cada persona debe tener un PIN único.', 'error');
    if (role === 'dependiente') { const count = await one("SELECT COUNT(*) AS n FROM usuarios WHERE rol='dependiente' AND activo=1"); if (Number(count?.n||0) >= 2) return notify('Solo puede haber dos dependientes activos.', 'error'); }
    const userId = id();
    await run('INSERT INTO usuarios(id,nombre,pin_hash,rol,activo,creado_en) VALUES(?,?,?,?,1,?)',
      [userId,name,await hashPin(pin),role,localDateTime()]);
    await audit(pinOwner, 'crear_usuario', { nombre: name, rol: role });
    closeModal(); await renderShell(); notify('Usuario creado.', 'success');
  };
}

async function toggleUserStatus(userId) {
  const target = await one('SELECT * FROM usuarios WHERE id=?', [userId]);
  if (!target) throw new Error('No se encontró el usuario.');
  if (target.id === state.user.id && Number(target.activo) === 1) {
    throw new Error('No puedes desactivar el usuario con el que tienes la sesión abierta.');
  }
  const admin = await requestAdminPin(`${Number(target.activo) ? 'Desactivar' : 'Activar'} al usuario ${target.nombre}`);
  if (!admin) return;
  if (Number(target.activo) === 1 && target.rol === 'administrador') {
    const activeAdmins = await one("SELECT COUNT(*) AS n FROM usuarios WHERE rol='administrador' AND activo=1");
    if (Number(activeAdmins?.n || 0) <= 1) throw new Error('Debe quedar al menos un administrador activo.');
  }
  const next = Number(target.activo) ? 0 : 1;
  await run('UPDATE usuarios SET activo=? WHERE id=?', [next,userId]);
  await audit(admin, next ? 'activar_usuario' : 'desactivar_usuario', { usuario_id: userId, nombre: target.nombre, rol: target.rol });
  closeModal(); await renderShell(); notify(next ? 'Usuario activado.' : 'Usuario desactivado.', 'success');
}

async function changeUserPin(userId) {
  const target = await one('SELECT * FROM usuarios WHERE id=?', [userId]);
  if (!target) throw new Error('No se encontró el usuario.');
  const admin = await requestAdminPin(`Cambiar el PIN de ${target.nombre}`);
  if (!admin) return;
  setModal(`<div class="modal-head"><span class="eyebrow">SEGURIDAD DE USUARIOS</span><button class="icon-close" data-act="modal-close">×</button></div><h2>Nuevo PIN</h2><p>Usuario: <strong>${esc(target.nombre)}</strong>. El PIN anterior dejará de funcionar.</p><form id="change-user-pin-form" class="form-grid"><label>Nuevo PIN<input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required></label><label>Repetir PIN<input name="confirm" type="password" inputmode="numeric" minlength="4" maxlength="8" pattern="[0-9]{4,8}" required></label><div class="modal-actions"><button type="button" class="btn secondary" data-act="modal-close">Cancelar</button><button type="submit" class="btn primary">Guardar PIN</button></div></form>`);
  const host = document.querySelector('#modal-root');
  host.querySelectorAll('[data-act="modal-close"]').forEach(btn => btn.onclick = closeModal);
  host.querySelector('#change-user-pin-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const pin = String(form.get('pin'));
    if (pin !== String(form.get('confirm'))) return notify('Los PIN no coinciden.', 'error');
    if (await pinAlreadyInUse(pin, userId)) return notify('Ese PIN ya está asignado a otro usuario.', 'error');
    await run('UPDATE usuarios SET pin_hash=? WHERE id=?', [await hashPin(pin),userId]);
    await audit(admin, 'cambiar_pin_usuario', { usuario_id: userId, nombre: target.nombre, rol: target.rol });
    closeModal(); await renderShell(); notify('PIN actualizado correctamente.', 'success');
  };
}

async function filterProducts(text) {
  const rows = await query('SELECT * FROM productos WHERE nombre LIKE ? OR codigo LIKE ? ORDER BY nombre COLLATE NOCASE', [`%${text}%`,`%${text}%`]);
  const tbody = document.querySelector('#products-rows');
  if (tbody) tbody.innerHTML = productRows(rows, Boolean(state.hideStockInProductList));
}

function archiveFileToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function parseImportFile(picked) {
  const bytes = base64ToBytes(picked.base64);
  let archive = {};
  let payload;
  const looksZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (looksZip) {
    archive = readZip(bytes);
    const manifestName = ['catalogo.json', 'producto.json', 'productos.json'].find(name => archive[name]);
    if (!manifestName) throw new Error('El ZIP no contiene catalogo.json, producto.json ni productos.json.');
    payload = JSON.parse(strFromU8(archive[manifestName]));
  } else {
    payload = JSON.parse(strFromU8(bytes));
  }
  if (!(await verifyPayload(payload))) throw new Error('El archivo no es válido o su hash SHA-256 no coincide.');
  const names = Object.keys(archive);
  const existing = await query('SELECT codigo,nombre,precio_usd,stock,foto_base64 FROM productos');
  let plan;
  if (payload.tipo === 'catalogo') plan = buildCatalogImportPlan(payload, existing, names);
  else if (payload.tipo === 'producto') plan = buildSingleProductImportPlan(payload, existing, names);
  else if (payload.tipo === 'productos' && Array.isArray(payload.productos)) {
    const catalogLike = { tipo: 'catalogo', version: 1, productos: payload.productos, inventario_corregido: false };
    plan = buildCatalogImportPlan(catalogLike, existing, names);
    plan.kind = 'productos';
  } else throw new Error('Tipo de archivo no compatible. Se esperaba catálogo o producto nuevo.');
  return { picked, archive, payload, plan };
}

async function importCatalog() {
  const admin = await requestAdminPin('Importar catálogo o productos nuevos desde la PC');
  if (!admin) return;
  const picked = await pickArchive();
  const prepared = await parseImportFile(picked);
  state.pendingImport = { ...prepared, admin };
  const { plan } = prepared;
  const statusLabel = { nuevo: 'Nuevo', actualizar: 'Actualizar', error: 'Error' };
  const visibleRows = plan.rows.slice(0, 40).map(row => `<div class="import-preview-row ${row.status === 'error' ? 'has-error' : ''}"><span>${row.index}</span><div><strong>${esc(row.codigo || row.product?.codigo || `Registro ${row.index}`)} · ${esc(row.nombre || row.product?.nombre || 'Sin nombre')}</strong><small>${row.status === 'error' ? esc(row.reason) : row.status === 'actualizar' ? 'Actualiza nombre/precio/foto; conserva el stock actual salvo corrección de inventario.' : `Nuevo · precio ${formatUSD(row.product.precio_usd)} · stock inicial ${row.product.stock}`}</small></div><b>${statusLabel[row.status]}</b></div>`).join('');
  const correctionWarning = plan.inventoryCorrected
    ? '<div class="warning-box">Este archivo está marcado como <strong>inventario corregido</strong>. Al confirmar, también reemplazará el stock de los productos existentes.</div>'
    : '<div class="info-line">El stock local de productos existentes se conservará. Los productos nuevos entrarán con el stock indicado en el archivo.</div>';
  setModal(`<div class="modal-head"><span class="eyebrow">VISTA PREVIA DE IMPORTACIÓN</span><button class="icon-close" data-act="modal-close">×</button></div><h2>${plan.kind === 'producto' ? 'Importar producto' : 'Importar catálogo'}</h2><p class="muted">Archivo: ${esc(picked.fileName || 'archivo.json')}</p><div class="import-counts"><div><small>Nuevos</small><strong>${plan.created}</strong></div><div><small>Actualizados</small><strong>${plan.updated}</strong></div><div class="${plan.errors ? 'error-count' : ''}"><small>Errores</small><strong>${plan.errors}</strong></div></div>${correctionWarning}<div class="import-preview-list">${visibleRows || '<p class="muted">El archivo no contiene productos.</p>'}</div>${plan.rows.length > 40 ? `<p class="muted">Mostrando 40 de ${plan.rows.length} registros. Los conteos incluyen todos.</p>` : ''}<p class="muted">Se aplicarán ${plan.applicable} registros válidos. Los ${plan.errors} errores se omitirán y no modificarán el catálogo.</p><div class="modal-actions"><button class="btn secondary" data-act="modal-close">Cancelar</button><button class="btn primary" data-act="confirm-import" ${plan.applicable === 0 ? 'disabled' : ''}>Confirmar importación</button></div>`);
  document.querySelector('#modal-root').querySelectorAll('[data-act="modal-close"]').forEach(button => button.onclick = () => { state.pendingImport = null; closeModal(); });
}

async function confirmCatalogImport() {
  const pending = state.pendingImport;
  if (!pending) throw new Error('No hay una importación pendiente de confirmar.');
  const { plan, archive, admin, picked } = pending;
  const rows = applyableRows(plan);
  if (!rows.length) throw new Error('No hay productos válidos para importar.');
  if (plan.inventoryCorrected && !window.confirm('El archivo está marcado como inventario corregido. ¿Confirmas reemplazar el stock local de los productos existentes?')) return;
  let created = 0, updated = 0;
  await transaction(async () => {
    for (const row of rows) {
      const item = row.product;
      const photo = item.foto && archive[item.foto] ? archiveFileToBase64(archive[item.foto]) : null;
      if (row.status === 'actualizar') {
        await run(`UPDATE productos SET nombre=?,precio_usd=?,stock=?,foto_base64=?,origen='catalogo',pendiente_sync=0,actualizado_en=? WHERE codigo=?`,
          [item.nombre, item.precio_usd, plan.inventoryCorrected ? item.stock : row.current.stock,
            photo ?? row.current.foto_base64, localDateTime(), item.codigo]);
        updated++;
      } else {
        await run(`INSERT INTO productos(codigo,nombre,precio_usd,stock,stock_inicial,foto_base64,origen,pendiente_sync,actualizado_en)
          VALUES(?,?,?,?,?,?,'catalogo',0,?)`, [item.codigo, item.nombre, item.precio_usd, item.stock, item.stock, photo, localDateTime()]);
        created++;
      }
    }
  });
  await audit(admin, plan.kind === 'producto' ? 'importar_producto' : 'importar_catalogo', {
    archivo: picked.fileName || 'archivo.zip', creados: created, actualizados: updated,
    errores_omitidos: plan.errors, inventario_corregido: plan.inventoryCorrected
  });
  state.pendingImport = null;
  closeModal();
  await renderShell();
  notify(`Importación completada: ${created} nuevos, ${updated} actualizados y ${plan.errors} errores omitidos.`, 'success');
}

async function createBackup() {
  const admin = await requestAdminPin('Crear un respaldo completo');
  if (!admin) return;
  const tables = Object.keys(BACKUP_TABLE_COLUMNS);
  const data = {};
  for (const table of tables) data[table] = await query(`SELECT * FROM ${table}`);
  const payload = await signPayload({ tipo: 'respaldo_cajero', version: 2, generado_en: localDateTime(), data });
  const archive = createZip({ 'respaldo.json': canonicalJSON(payload) });
  const filename = `respaldo_CH_${localDate()}_${(await getConfig('id_dispositivo')||'DEVICE').replace(/[^a-zA-Z0-9_-]/g,'')}.zip`;
  const result = await saveAndShare(filename, archive, 'Respaldo CH Cajero', 'Respaldo completo del cajero. Conserva este archivo en un lugar seguro.');
  await audit(admin, 'crear_respaldo', { archivo: filename, hash: payload.hash });
  notify(result.nativeShare === false ? 'Respaldo guardado en el teléfono. No se pudo abrir el menú de compartir.' : 'Respaldo creado y guardado.', result.nativeShare === false ? 'warning' : 'success');
}

async function restoreBackup() {
  const admin = await requestAdminPin('Restaurar el respaldo completo');
  if (!admin) return;
  const picked = await pickArchive();
  const archive = readZip(base64ToBytes(picked.base64));
  if (!archive['respaldo.json']) throw new Error('El ZIP no contiene respaldo.json.');
  const payload = JSON.parse(strFromU8(archive['respaldo.json']));
  if (!(await verifyPayload(payload))) throw new Error('El respaldo no es válido o su hash SHA-256 no coincide.');
  const validation = validateBackupPayload(payload);
  if (!validation.valid) throw new Error(validation.reason);
  state.pendingRestore = { payload, admin, filename: picked.fileName || 'respaldo.zip', rowCounts: validation.rowCounts };
  const countRows = Object.entries(validation.rowCounts).map(([table, count]) => `<div><span>${esc(table)}</span><strong>${count}</strong></div>`).join('');
  setModal(`<div class="modal-head"><span class="eyebrow">RESTAURACIÓN DE RESPALDO</span><button class="icon-close" data-act="modal-close">×</button></div><h2>Reemplazar datos del teléfono</h2><p>Archivo verificado: <strong>${esc(picked.fileName || 'respaldo.zip')}</strong></p><p>Generado: ${esc(payload.generado_en || 'fecha no indicada')}</p><div class="backup-counts">${countRows}</div><div class="warning-box">Esta operación reemplazará los productos, usuarios, caja, ventas, pagos, cierres y auditoría actuales. Al terminar tendrás que iniciar sesión con los usuarios incluidos en el respaldo.</div><div class="modal-actions"><button class="btn secondary" data-act="modal-close">Cancelar</button><button class="btn danger-outline" data-act="confirm-restore">Confirmar restauración</button></div>`);
  document.querySelector('#modal-root').querySelectorAll('[data-act="modal-close"]').forEach(button => button.onclick = () => { state.pendingRestore = null; closeModal(); });
}

async function confirmRestoreBackup() {
  const pending = state.pendingRestore;
  if (!pending) throw new Error('No hay una restauración pendiente de confirmar.');
  const { payload, admin, filename } = pending;
  const data = normalizeBackupData(payload);
  const tables = Object.keys(BACKUP_TABLE_COLUMNS);
  const deleteOrder = ['conteo_detalle','conteos','movimientos_inventario','pagos','lineas_venta','ventas','turnos','jornadas','cierres','auditoria','productos','usuarios','config'];
  await transaction(async () => {
    for (const table of deleteOrder) await execute(`DELETE FROM ${table}`);
    for (const table of tables) {
      const columns = BACKUP_TABLE_COLUMNS[table];
      const quotedColumns = columns.map(column => `"${column}"`).join(',');
      const placeholders = columns.map(() => '?').join(',');
      for (const row of data[table]) {
        await run(`INSERT INTO ${table}(${quotedColumns}) VALUES(${placeholders})`, columns.map(column => row[column]));
      }
    }
  });
  const restoredAdmin = await one("SELECT * FROM usuarios WHERE rol='administrador' AND activo=1 LIMIT 1");
  await audit(restoredAdmin || admin, 'restaurar_respaldo', { archivo: filename, hash: payload.hash });
  state.pendingRestore = null;
  state.user = null; state.day = null; state.sale = null; state.product = null;
  closeModal();
  renderLogin(await query('SELECT * FROM usuarios WHERE activo=1 ORDER BY nombre'));
  notify('Respaldo restaurado. Inicia sesión con un usuario del respaldo.', 'success');
}

async function reshareClosure(closureId) {
  const closure = await one('SELECT * FROM cierres WHERE id=?', [closureId]);
  if (!closure) throw new Error('No se encontró el cierre guardado.');
  const payload = JSON.parse(closure.payload_json);
  if (!(await verifyPayload(payload))) throw new Error('El cierre guardado no supera la verificación SHA-256.');
  const archive = createZip({ 'cierre.json': canonicalJSON(payload) });
  await shareExistingZip(closure.archivo_generado, archive, 'Cierre diario CH Cajero', `Cierre del ${closure.fecha}.`);
  await run('UPDATE cierres SET exportado_en=? WHERE id=?', [localDateTime(),closureId]);
  notify('Cierre compartido.', 'success');
}

async function resumeStoredDayClosure(closure) {
  await reshareClosure(closure.id);
  await run("UPDATE jornadas SET estado='cerrada',cerrada_en=COALESCE(cerrada_en,?) WHERE id=?", [localDateTime(),state.day.id]);
  closeModal(); state.day = null; state.sale = null; state.view = 'caja';
  renderDayClosed();
  notify('El cierre que ya estaba guardado se volvió a compartir. No se generó un cierre duplicado.', 'success');
}

async function showDayClosePreview() {
  const existingClosure = await one('SELECT id FROM cierres WHERE fecha=? ORDER BY generado_en DESC LIMIT 1', [state.day.fecha]);
  if (existingClosure) return resumeStoredDayClosure(existingClosure);
  const openTurns = await one('SELECT COUNT(*) AS n FROM turnos WHERE fin IS NULL');
  if (Number(openTurns?.n || 0) > 0) return notify('Antes de cerrar el día, todos los dependientes deben cerrar sus turnos.', 'warning');
  const active = await one("SELECT COUNT(*) AS n FROM ventas WHERE jornada_id=? AND estado IN ('abierta','pausada')", [state.day.id]);
  if (Number(active?.n) > 0) return notify('No puedes cerrar el día mientras haya ventas abiertas o pausadas. Termínalas o anúlalas primero.', 'error');
  const activeCounts = await one("SELECT COUNT(*) AS n FROM conteos WHERE estado IN ('en_curso','reconteo')");
  if (Number(activeCounts?.n) > 0) return notify('Termina los conteos de inventario pendientes antes de cerrar el día.', 'error');
  const sales = await query("SELECT * FROM ventas WHERE jornada_id=? AND estado IN ('cerrada','anulada','cancelada')", [state.day.id]);
  const validSales = sales.filter(sale => sale.estado === 'cerrada');
  const total = roundMoney(validSales.reduce((sum,sale) => sum + Number(sale.total_usd),0));
  const paymentRows = await query(`SELECT p.metodo,p.monto_original AS monto,p.moneda,p.equivalente_usd
    FROM pagos p JOIN ventas v ON v.id=p.venta_id
    WHERE v.jornada_id=? AND v.estado='cerrada' AND p.estado='activo'`, [state.day.id]);
  const changes = validSales.map(sale => ({ moneda: sale.vuelto_moneda || null, monto: Number(sale.vuelto_monto || 0) }));
  const drawer = calculateDrawerBalances(paymentRows, changes);
  const methodTotals = {};
  for (const payment of paymentRows) methodTotals[payment.metodo] = roundMoney((methodTotals[payment.metodo] || 0) + Number(payment.monto || 0));
  setModal(`<div class="modal-head"><span class="eyebrow">CIERRE DIARIO</span><button class="icon-close" data-act="modal-close">×</button></div>
    <h2>Resumen de caja</h2>
    <div class="close-stats"><div><small>Ventas cerradas</small><strong>${validSales.length}</strong></div><div><small>Total USD</small><strong>${formatUSD(total)}</strong></div><div><small>Ventas canceladas</small><strong>${sales.filter(s=>s.estado==='cancelada').length}</strong></div></div>
    <div class="close-methods"><div><span>USD recibido</span><strong>${formatUSD(methodTotals.USD || 0)}</strong></div><div><span>CUP efectivo recibido</span><strong>${formatCUP(methodTotals.CUP || 0)}</strong></div><div><span>Transferencias</span><strong>${formatCUP(methodTotals.TRANSFER || 0)}</strong></div><div><span>Efectivo USD esperado</span><strong>${formatUSD(drawer.efectivo_usd_esperado)}</strong></div><div><span>Efectivo CUP esperado</span><strong>${formatCUP(drawer.efectivo_cup_esperado)}</strong></div></div>
    <div class="two-cols"><label>Efectivo USD contado<input id="drawer-count-usd" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Introduce el conteo físico" required></label><label>Efectivo CUP contado<input id="drawer-count-cup" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Introduce el conteo físico" required></label></div>
    <p class="muted">La aplicación comparará lo contado con lo esperado y guardará cualquier diferencia en el cierre firmado V3.</p>
    <div class="modal-actions"><button class="btn secondary" data-act="modal-close">Cancelar</button><button class="btn primary" data-act="confirm-close-day">Cerrar día y compartir</button></div>`);
  document.querySelector('#modal-root').querySelectorAll('[data-act="modal-close"]').forEach(btn => btn.onclick = closeModal);
}

async function closeDayAndShare() {
  const existingClosure = await one('SELECT id FROM cierres WHERE fecha=? ORDER BY generado_en DESC LIMIT 1', [state.day.fecha]);
  if (existingClosure) return resumeStoredDayClosure(existingClosure);
  const openTurns = await one('SELECT COUNT(*) AS n FROM turnos WHERE fin IS NULL');
  if (Number(openTurns?.n || 0) > 0) throw new Error('Antes de cerrar el día, todos los dependientes deben cerrar sus turnos.');
  const active = await one("SELECT COUNT(*) AS n FROM ventas WHERE jornada_id=? AND estado IN ('abierta','pausada')", [state.day.id]);
  if (Number(active?.n) > 0) throw new Error('Hay ventas abiertas o pausadas. No se puede cerrar la jornada.');
  const activeCounts = await one("SELECT COUNT(*) AS n FROM conteos WHERE estado IN ('en_curso','reconteo')");
  if (Number(activeCounts?.n) > 0) throw new Error('Hay conteos de inventario sin finalizar. No se puede cerrar la jornada.');

  const countedUsdText = document.querySelector('#drawer-count-usd')?.value;
  const countedCupText = document.querySelector('#drawer-count-cup')?.value;
  if (countedUsdText === undefined || countedCupText === undefined || countedUsdText === '' || countedCupText === '') {
    throw new Error('Introduce el efectivo USD y CUP contado físicamente antes de cerrar.');
  }
  const countedUsd = moneyInput(countedUsdText);
  const countedCup = moneyInput(countedCupText);
  if (!Number.isFinite(countedUsd) || countedUsd < 0 || !Number.isFinite(countedCup) || countedCup < 0) {
    throw new Error('Los importes contados deben ser números válidos y no negativos.');
  }

  const sales = await query("SELECT * FROM ventas WHERE jornada_id=? AND estado IN ('cerrada','anulada','cancelada') ORDER BY fecha_hora", [state.day.id]);
  const exported = [];
  for (const sale of sales) {
    const lines = await getSaleLines(sale.id);
    const payments = await getSalePayments(sale.id);
    const user = await one('SELECT nombre FROM usuarios WHERE id=?', [sale.dependiente_id]);
    exported.push({
      id: sale.id, numero_local: sale.numero_local, hora: localTime(sale.fecha_hora), fecha_hora: sale.fecha_hora,
      dependiente: user?.nombre || 'Dependiente', dependiente_id: sale.dependiente_id, turno_id: sale.turno_id || null,
      estado: sale.estado, tasa_cup: Number(sale.tasa_cup), recargo_transf: Number(sale.recargo_transf), total_usd: Number(sale.total_usd),
      lineas: lines.map(line => ({ id: line.id, codigo: line.codigo, nombre: line.nombre_snapshot, cant: Number(line.cantidad),
        precio_usd: Number(line.precio_snapshot), subtotal_usd: roundMoney(Number(line.cantidad)*Number(line.precio_snapshot)),
        anulada: Boolean(Number(line.anulada)), motivo_anulacion: line.motivo_anulacion || null })),
      pagos: payments.map(payment => ({ id: payment.id, metodo: payment.metodo, monto: Number(payment.monto_original), moneda: payment.moneda,
        tasa_aplicada: Number(payment.tasa_aplicada), equiv_usd: Number(payment.equivalente_usd), estado: payment.estado || 'activo',
        anulado_por: payment.anulado_por || null, anulado_en: payment.anulado_en || null })),
      vuelto: { moneda: sale.vuelto_moneda || null, monto: Number(sale.vuelto_monto || 0) },
      motivo_anulacion: sale.motivo_anulacion || null
    });
  }

  const store = await getConfig('nombre_tienda') || 'CH';
  const device = await getConfig('id_dispositivo') || 'DEVICE';
  const productsNew = await query("SELECT codigo,nombre,precio_usd,stock_inicial,foto_base64,creado_en,creado_por FROM productos WHERE pendiente_sync=1 ORDER BY codigo");
  const products = await query('SELECT codigo,stock FROM productos ORDER BY codigo');
  const closedSales = exported.filter(sale => sale.estado === 'cerrada' || sale.estado === 'anulada');
  const cancelledSales = exported.filter(sale => sale.estado === 'cancelada');
  const paidSales = exported.filter(sale => sale.estado === 'cerrada');
  const methodSummary = {};
  const drawerBalances = calculateDrawerBalances(
    paidSales.flatMap(sale => sale.pagos.filter(payment => payment.estado === 'activo').map(payment => ({ ...payment, monto: payment.monto }))),
    paidSales.map(sale => sale.vuelto)
  );
  for (const sale of paidSales) for (const payment of sale.pagos.filter(item => item.estado === 'activo')) {
    if (!methodSummary[payment.metodo]) methodSummary[payment.metodo] = { monto_original: 0, moneda: payment.moneda, equivalente_usd: 0 };
    methodSummary[payment.metodo].monto_original = roundMoney(methodSummary[payment.metodo].monto_original + payment.monto);
    methodSummary[payment.metodo].equivalente_usd = roundMoney(methodSummary[payment.metodo].equivalente_usd + payment.equiv_usd);
  }

  const turns = await query(`SELECT t.id,t.usuario_id,u.nombre AS usuario,t.inicio,t.fin
    FROM turnos t JOIN usuarios u ON u.id=t.usuario_id WHERE t.inicio>=? ORDER BY t.inicio`, [state.day.abierta_en]);
  const movementRows = await query('SELECT * FROM movimientos_inventario WHERE fecha_hora>=? ORDER BY fecha_hora,rowid', [state.day.abierta_en]);
  const entries = movementRows.filter(row => row.tipo === 'entrada').map(row => ({ id: row.id, hora: row.fecha_hora, usuario: row.usuario,
    codigo: row.codigo, cant: Number(row.cantidad), nota: row.nota || '', estado: row.estado }));
  const exits = movementRows.filter(row => row.tipo === 'salida').map(row => ({ id: row.id, hora: row.fecha_hora, usuario: row.usuario,
    codigo: row.codigo, cant: Number(row.cantidad), motivo: row.motivo || '', nota: row.nota || '' }));
  const adjustments = movementRows.filter(row => row.tipo === 'ajuste_conteo' && row.estado === 'confirmado').map(row => ({ id: row.id,
    codigo: row.codigo, delta: Number(row.cantidad), de: row.stock_antes === null ? null : Number(row.stock_antes),
    a: row.stock_despues === null ? null : Number(row.stock_despues), motivo: row.motivo || '',
    aprobado_por: row.usuario, movimiento_origen: row.movimiento_origen || null, hora: row.fecha_hora }));
  const countRows = await query('SELECT * FROM conteos WHERE fecha_inicio>=? ORDER BY fecha_inicio', [state.day.abierta_en]);
  const counts = [];
  for (const count of countRows) {
    const details = await query('SELECT * FROM conteo_detalle WHERE conteo_id=? ORDER BY codigo', [count.id]);
    const user = await one('SELECT nombre FROM usuarios WHERE id=?', [count.usuario_id]);
    counts.push({ id: count.id, inicio: count.fecha_inicio, fin: count.fecha_fin, usuario: user?.nombre || 'Dependiente', estado: count.estado,
      detalle: details.map(row => ({ codigo: row.codigo, esperado: Number(row.esperado_al_contar), conteo_1: row.conteo_1 === null ? null : Number(row.conteo_1),
        hora_1: row.hora_1 || null, conteo_2: row.conteo_2 === null ? null : Number(row.conteo_2), hora_2: row.hora_2 || null,
        resultado: row.resultado, decision_admin: row.decision_admin || null, motivo: row.motivo || null, visible_para: row.visible_para || null })) });
  }
  const annulments = await query("SELECT fecha_hora,usuario,accion,detalle,hash_anterior,hash_evento FROM auditoria WHERE accion IN ('anular_linea','anular_venta','pago_anulado','venta_cancelada') ORDER BY rowid");
  const auditRows = await query('SELECT rowid AS orden,id,fecha_hora,usuario_id,usuario,accion,detalle,turno_id,hash_anterior,hash_evento FROM auditoria ORDER BY rowid');

  const totalPaid = roundMoney(paidSales.reduce((sum,sale) => sum + sale.total_usd,0));
  const now = localDateTime();
  const lastClosure = await one('SELECT id,hash,secuencia FROM cierres ORDER BY generado_en DESC,rowid DESC LIMIT 1');
  const closeCount = await one('SELECT COUNT(*) AS n FROM cierres');
  const sequence = Number(lastClosure?.secuencia || closeCount?.n || 0) + 1;
  const previousHash = lastClosure?.hash || null;
  const closureId = id();
  const countedByMethod = {
    usd: roundMoney(countedUsd), cup: roundMoney(countedCup)
  };
  const drawer = {
    esperado_usd: drawerBalances.efectivo_usd_esperado,
    contado_usd: countedByMethod.usd,
    diferencia_usd: roundMoney(countedByMethod.usd - drawerBalances.efectivo_usd_esperado),
    esperado_cup: drawerBalances.efectivo_cup_esperado,
    contado_cup: countedByMethod.cup,
    diferencia_cup: roundMoney(countedByMethod.cup - drawerBalances.efectivo_cup_esperado)
  };
  await audit(state.user, 'generar_cierre_diario', { id_cierre: closureId, secuencia: sequence, arqueo: drawer });
  const closureAuditRows = await query('SELECT rowid AS orden,id,fecha_hora,usuario_id,usuario,accion,detalle,turno_id,hash_anterior,hash_evento FROM auditoria ORDER BY rowid');
  const payload = await signPayload({
    tipo: 'cierre_ventas', version: 3, id_cierre: closureId, secuencia: sequence, hash_anterior: previousHash,
    tienda: store, dispositivo: device, fecha: state.day.fecha, generado_en: now, tasa_cup: Number(state.day.tasa_cup),
    turnos, ventas: closedSales, ventas_canceladas: cancelledSales,
    inventario: { entradas: entries, salidas: exits, conteos, ajustes_aprobados: adjustments },
    arqueo: drawer, anulaciones: annulments, auditoria: closureAuditRows,
    productos_nuevos: productsNew.map(product => ({ codigo: product.codigo, nombre: product.nombre, precio_usd: Number(product.precio_usd),
      stock_inicial: Number(product.stock_inicial ?? product.stock), foto_base64: product.foto_base64 || null,
      creado_en: product.creado_en || null, creado_por: product.creado_por || null })),
    resumen: { n_ventas: paidSales.length, total_usd: totalPaid, por_metodo: methodSummary,
      n_ventas_canceladas: cancelledSales.length, n_pagos_anulados: exported.reduce((sum,sale)=>sum+sale.pagos.filter(payment=>payment.estado==='anulado').length,0),
      transferencias: drawerBalances.transferencias, efectivo_usd_esperado: drawerBalances.efectivo_usd_esperado,
      efectivo_cup_esperado: drawerBalances.efectivo_cup_esperado,
      n_anulaciones: exported.filter(sale=>sale.estado==='anulada').length },
    stock_final: products
  });
  const filename = `ventas_${state.day.fecha}_${store.replace(/[^a-zA-Z0-9_-]/g,'_')}_${device.replace(/[^a-zA-Z0-9_-]/g,'_')}.zip`;
  const archive = createZip({ 'cierre.json': canonicalJSON(payload) });
  // Persistencia de cierre, bloqueo de jornada y auditoría en una sola transacción.
  await transaction(async () => {
    await run(`INSERT INTO cierres(id,fecha,archivo_generado,hash,generado_en,exportado_en,payload_json,secuencia,hash_anterior)
      VALUES(?,?,?,?,?,?,?,?,?)`, [payload.id_cierre,state.day.fecha,filename,payload.hash,now,null,canonicalJSON(payload),sequence,previousHash]);
    await run("UPDATE jornadas SET estado='cerrada',cerrada_en=? WHERE id=? AND estado='abierta'", [localDateTime(),state.day.id]);
    await audit(state.user, 'cierre_diario', { id_cierre: payload.id_cierre, archivo: filename, hash: payload.hash, secuencia: sequence });
  });
  // Compartir ocurre después del commit; si Android no abre WhatsApp, el mismo cierre se reenvía.
  await saveAndShare(filename, archive, 'Cierre diario CH Cajero', `Ventas e inventario del ${state.day.fecha}. Cierre V3 con SHA-256 y cadena de integridad.`);
  await run('UPDATE cierres SET exportado_en=? WHERE id=?', [localDateTime(),payload.id_cierre]);
  closeModal(); state.day = null; state.sale = null; state.view = 'caja';
  renderDayClosed();
  notify(drawer.diferencia_usd !== 0 || drawer.diferencia_cup !== 0 ? 'Día cerrado. Se registró una diferencia en el arqueo.' : 'Día cerrado. Arqueo coincidente y archivo guardado.', drawer.diferencia_usd !== 0 || drawer.diferencia_cup !== 0 ? 'warning' : 'success');
}

function renderDayClosed() {
  setScannerEnabled(false);
  root.innerHTML = `<main class="auth-page"><img class="welcome-logo" src="/logo_ch.png" alt="CH"><div class="eyebrow">CIERRE COMPLETADO</div><h1>La caja de hoy está cerrada</h1><p class="muted">El cierre diario fue generado y guardado. No se pueden registrar más ventas en esta jornada.</p><div class="panel form-grid"><p>Vuelve a entrar el próximo día para abrir una nueva caja e introducir la tasa CUP/USD correspondiente.</p><button class="btn primary wide" id="back-login">Volver al acceso</button></div></main>`;
  document.querySelector('#back-login').onclick = async () => renderLogin(await query('SELECT * FROM usuarios WHERE activo=1 ORDER BY nombre'));
}

async function showSaleDetail(saleId) {
  const sale = await one('SELECT * FROM ventas WHERE id=?', [saleId]);
  if (!sale) throw new Error('No se encontró la venta.');
  const totals = await getSaleTotals(saleId);
  const user = await one('SELECT nombre FROM usuarios WHERE id=?', [sale.dependiente_id]);
  state.currentDetail = saleId;
  setModal(`<div class="modal-head"><span class="eyebrow">DETALLE DE VENTA #${sale.numero_local}</span><button class="icon-close" data-act="modal-close">×</button></div><div class="detail-summary"><div><small>Estado</small><strong>${esc(sale.estado)}</strong></div><div><small>Total</small><strong>${formatUSD(sale.total_usd)}</strong></div><div><small>Dependiente</small><strong>${esc(user?.nombre||'')}</strong></div></div><h3>Productos</h3><div class="detail-lines">${totals.lines.map(line => `<div class="detail-line ${Number(line.anulada)?'line-annulled':''}"><div><strong>${esc(line.nombre_snapshot)}</strong><small>${esc(line.codigo)} · ${line.cantidad} × ${formatUSD(line.precio_snapshot)}</small>${line.motivo_anulacion?`<small>Motivo: ${esc(line.motivo_anulacion)}</small>`:''}</div><strong>${formatUSD(line.precio_snapshot*line.cantidad)}</strong>${sale.estado==='cerrada' && !Number(line.anulada)?`<button class="btn small danger-outline" data-act="annul-line" data-id="${esc(line.id)}">Anular línea</button>`:''}</div>`).join('')}</div><h3>Pagos</h3><div class="detail-lines">${totals.payments.map(payment=>`<div class="payment-row"><span>${esc(payment.metodo)} · ${formatMoneyMethod(payment.monto_original,payment.moneda)} · ${esc(payment.estado||'activo')}</span><strong>${formatUSD(payment.equivalente_usd)}</strong></div>`).join('') || '<p class="muted">Sin pagos registrados.</p>'}</div><div class="detail-footer"><span>Tasa histórica: ${sale.tasa_cup} CUP/USD · Recargo: ${sale.recargo_transf}%</span>${sale.estado==='cerrada'?`<button class="btn danger-outline" data-act="annul-sale" data-id="${esc(sale.id)}">Anular venta completa</button>`:''}</div>`);
  document.querySelector('#modal-root').querySelectorAll('[data-act="modal-close"]').forEach(btn => btn.onclick = closeModal);
}

function requestAnnulment(title, description) {
  return new Promise(resolve => {
    setModal(`<div class="modal-head"><span class="eyebrow">ANULACIÓN AUDITADA</span><button class="icon-close" id="annul-cancel">×</button></div><h2>${esc(title)}</h2><p>${esc(description)}</p><form id="annul-form" class="form-grid"><label>Motivo obligatorio<textarea name="reason" required minlength="3" maxlength="300" rows="3"></textarea></label><label>PIN del administrador<input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="8" required></label><div class="modal-actions"><button type="button" class="btn secondary" id="annul-cancel-2">Cancelar</button><button type="submit" class="btn danger">Confirmar anulación</button></div></form>`);
    const host = document.querySelector('#modal-root');
    const cancel = () => { closeModal(); resolve(null); };
    host.querySelector('#annul-cancel').onclick = cancel;
    host.querySelector('#annul-cancel-2').onclick = cancel;
    host.querySelector('#annul-form').onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const admins = await query("SELECT * FROM usuarios WHERE activo=1 AND rol='administrador'");
      let admin = null;
      for (const item of admins) if (await verifyPin(form.get('pin'), item.pin_hash)) { admin = item; break; }
      if (!admin) return notify('PIN de administrador incorrecto.', 'error');
      const reason = String(form.get('reason')).trim();
      if (reason.length < 3) return notify('Escribe el motivo de la anulación.', 'error');
      closeModal(); resolve({ admin, reason });
    };
  });
}

async function annulLine(lineId) {
  const line = await one('SELECT * FROM lineas_venta WHERE id=?', [lineId]);
  if (!line || Number(line.anulada)) return;
  const sale = await one('SELECT * FROM ventas WHERE id=?', [line.venta_id]);
  if (!sale || sale.estado !== 'cerrada') throw new Error('Solo se pueden anular líneas de ventas cerradas.');
  const authorization = await requestAnnulment('Anular línea de venta', `Se repondrán ${line.cantidad} unidades de ${line.nombre_snapshot} al stock local. Esta operación no elimina el historial.`);
  if (!authorization) return;
  await transaction(async () => {
    const changed = await run('UPDATE lineas_venta SET anulada=1,motivo_anulacion=? WHERE id=? AND anulada=0', [authorization.reason,lineId]);
    if (Number(changed?.changes || 0) !== 1) throw new Error('La línea ya estaba anulada.');
    await run('UPDATE productos SET stock=stock+?,actualizado_en=? WHERE codigo=?', [line.cantidad,localDateTime(),line.codigo]);
    await audit(authorization.admin, 'anular_linea', { venta: sale.id, linea: lineId, codigo: line.codigo, cantidad: line.cantidad, motivo: authorization.reason });
  });
  closeModal(); await renderShell(); notify('Línea anulada y stock repuesto.', 'success');
}

async function annulSale(saleId) {
  const sale = await one('SELECT * FROM ventas WHERE id=?', [saleId]);
  if (!sale || sale.estado === 'anulada') return;
  if (sale.estado !== 'cerrada') throw new Error('La anulación administrativa de una venta completa solo se aplica a ventas cerradas.');
  const lines = await getSaleLines(saleId);
  const authorization = await requestAnnulment('Anular venta completa', 'La venta quedará marcada como anulada. Si estaba cerrada, se repondrá al stock todo producto no anulado previamente.');
  if (!authorization) return;
  await transaction(async () => {
    const current = await one('SELECT estado FROM ventas WHERE id=?', [saleId]);
    if (!current || current.estado === 'anulada') throw new Error('La venta ya estaba anulada.');
    for (const movement of stockToRestore(current.estado, lines)) {
      await run('UPDATE productos SET stock=stock+?,actualizado_en=? WHERE codigo=?', [movement.cantidad,localDateTime(),movement.codigo]);
    }
    const changed = await run("UPDATE ventas SET estado='anulada',motivo_anulacion=? WHERE id=? AND estado<>'anulada'", [authorization.reason,saleId]);
    if (Number(changed?.changes || 0) !== 1) throw new Error('La venta cambió de estado y no pudo anularse.');
    await run('UPDATE lineas_venta SET anulada=1,motivo_anulacion=? WHERE venta_id=? AND anulada=0', [authorization.reason,saleId]);
    await audit(authorization.admin, 'anular_venta', { venta: saleId, motivo: authorization.reason, stock_repuesto: current.estado === 'cerrada' });
  });
  closeModal(); await renderShell(); notify('Venta anulada. El registro se conserva y el stock fue repuesto cuando correspondía.', 'success');
}

// La apertura de un día ya cerrado no se repite: la tasa y el cierre son únicos por fecha.
async function renderDayAlreadyClosed() {
  setScannerEnabled(false);
  root.innerHTML = `<main class="auth-page"><div class="brand-mark">CH</div><div class="eyebrow">JORNADA FINALIZADA</div><h1>La caja de hoy ya fue cerrada</h1><p class="muted">La jornada ${esc(localDate())} ya tiene un cierre registrado. No se permite abrir una segunda caja el mismo día.</p><button class="btn primary wide" id="back-login">Volver al acceso</button></main>`;
  document.querySelector('#back-login').onclick = async () => renderLogin(await query('SELECT * FROM usuarios WHERE activo=1 ORDER BY nombre'));
}

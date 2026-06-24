/* ═══ WALLET CONNECTION ═══ */

// Blockfrost mainnet — swap to testnet key + endpoint for testing
const BLOCKFROST_PROJECT_ID = 'mainnetRp7S5cPwjwv9zZ1deyHQiXUuQAcLmUWg';
const BLOCKFROST_BASE       = 'https://cardano-mainnet.blockfrost.io/api/v0';
const ADA_HANDLE_POLICY     = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';

// Known wallets (CIP-30 window key, display name, emoji fallback)
const KNOWN_WALLETS = [
  { key: 'eternl',  name: 'Eternl',  icon: '💙' },
  { key: 'nami',    name: 'Nami',    icon: '🐙' },
  { key: 'lace',    name: 'Lace',    icon: '🕊️' },
  { key: 'flint',   name: 'Flint',   icon: '🔥' },
  { key: 'yoroi',   name: 'Yoroi',   icon: '🦅' },
  { key: 'vespr',   name: 'Vespr',   icon: '🪐' },
  { key: 'typhon',  name: 'Typhon',  icon: '⚡' },
];

const walletModal    = document.getElementById('walletModal');
const walletList     = document.getElementById('walletList');
const modalClose     = document.getElementById('modalClose');
const connectBtn     = document.getElementById('connectWalletBtn');
const profileOverlay = document.getElementById('profileOverlay');
const profilePanel   = document.getElementById('profilePanel');
const ppClose        = document.getElementById('ppClose');
const ppDisconnect   = document.getElementById('ppDisconnect');

let connectedApi  = null;
let connectedAddr = null;

/* ── helpers ── */

function lovelaceToAda(lovelace) {
  return (parseInt(lovelace, 10) / 1_000_000).toLocaleString('en-GB', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function shortAddr(addr) {
  if (!addr) return '—';
  return addr.slice(0, 8) + '…' + addr.slice(-6);
}

async function blockfrostFetch(path) {
  const res = await fetch(BLOCKFROST_BASE + path, {
    headers: { project_id: BLOCKFROST_PROJECT_ID }
  });
  if (!res.ok) throw new Error(`Blockfrost ${res.status}: ${path}`);
  return res.json();
}

/* ── open / close modal ── */

function openWalletModal() {
  buildWalletList();
  walletModal.classList.add('open');
}
function closeWalletModal() {
  walletModal.classList.remove('open');
}

modalClose.addEventListener('click', closeWalletModal);
walletModal.addEventListener('click', e => { if (e.target === walletModal) closeWalletModal(); });

/* ── build wallet list ── */

function buildWalletList() {
  walletList.innerHTML = '';
  const available = KNOWN_WALLETS.filter(w => window.cardano?.[w.key]);
  const missing   = KNOWN_WALLETS.filter(w => !window.cardano?.[w.key]);

  const render = (w, installed) => {
    const btn = document.createElement('button');
    btn.className = 'wallet-btn';
    const iconEl = window.cardano?.[w.key]?.icon
      ? `<img src="${window.cardano[w.key].icon}" alt="${w.name} icon">`
      : `<div class="wallet-btn-icon">${w.icon}</div>`;
    btn.innerHTML = `
      ${iconEl}
      <div>
        <div class="wallet-btn-name">${w.name}</div>
        <div class="wallet-btn-status">${installed ? 'Detected in browser' : 'Not installed'}</div>
      </div>
      <span class="wallet-btn-badge ${installed ? '' : 'not-installed'}">${installed ? 'Connect' : 'Install'}</span>
    `;
    if (installed) {
      btn.addEventListener('click', () => connectWallet(w.key));
    } else {
      btn.style.opacity = '0.5';
    }
    walletList.appendChild(btn);
  };

  if (available.length === 0 && missing.length > 0) {
    walletList.innerHTML = `<p style="font-size:13px;color:var(--slate-400);text-align:center;padding:1rem 0">
      No Cardano wallets detected.<br>Install Eternl or Lace to get started.
    </p>`;
  } else {
    available.forEach(w => render(w, true));
    missing.forEach(w => render(w, false));
  }
}

/* ── bech32 encode (for converting raw address bytes → addr1...) ── */

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32Encode(hrp, data) {
  const combined = [...data, 0, 0, 0, 0, 0, 0];
  const checksum = bech32Polymod([...bech32HrpExpand(hrp), ...combined]) ^ 1;
  const chars = [...data];
  for (let i = 0; i < 6; i++) chars.push((checksum >> (5 * (5 - i))) & 31);
  return hrp + '1' + chars.map(d => BECH32_CHARSET[d]).join('');
}

function convertBits(data, fromBits, toBits, pad = true) {
  let acc = 0, bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; result.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) result.push((acc << (toBits - bits)) & maxv);
  return result;
}

function hexToBytes(hex) {
  return hex.match(/.{1,2}/g).map(b => parseInt(b, 16));
}

// CIP-30 returns CBOR-encoded address hex; decode to bech32 addr1...
function cborHexToAddress(hex) {
  const bytes = hexToBytes(hex);
  // CBOR bytes tag: if first byte is 0x40-0x57 it's a byte string of length (b & 0x1f)
  // if 0x58 the next byte is the length; strip the CBOR envelope
  let addrBytes;
  if (bytes[0] === 0x58) {
    addrBytes = bytes.slice(2);          // 0x58 <len> <addr bytes...>
  } else if ((bytes[0] & 0xe0) === 0x40) {
    addrBytes = bytes.slice(1);          // short bstr
  } else {
    addrBytes = bytes;                   // already raw (some wallets skip CBOR)
  }
  const hrp = (addrBytes[0] & 0xf0) === 0xe0 ? 'stake' : 'addr';
  const data5bit = convertBits(addrBytes, 8, 5);
  return bech32Encode(hrp, data5bit);
}

/* ── connect ── */

async function connectWallet(key) {
  closeWalletModal();
  try {
    const walletHandle = window.cardano[key];
    connectedApi = await walletHandle.enable();

    // Get change address as CBOR hex and convert to bech32 for Blockfrost
    const changeAddrHex = await connectedApi.getChangeAddress();
    connectedAddr = cborHexToAddress(changeAddrHex);

    localStorage.setItem('asc_wallet', key);

    connectBtn.textContent = shortAddr(connectedAddr);
    connectBtn.classList.add('connected');
    connectBtn.onclick = openProfilePanel;

    openProfilePanel();
  } catch (err) {
    console.error('Wallet connect failed:', err);
    localStorage.removeItem('asc_wallet');
  }
}

/* ── profile panel ── */

function openProfilePanel() {
  if (!connectedApi) return;
  profileOverlay.classList.add('open');
  profilePanel.classList.add('open');
  document.getElementById('ppAddress').textContent = shortAddr(connectedAddr);
  loadProfileData();
}

function closeProfilePanel() {
  profileOverlay.classList.remove('open');
  profilePanel.classList.remove('open');
}

ppClose.addEventListener('click', closeProfilePanel);
profileOverlay.addEventListener('click', closeProfilePanel);

ppDisconnect.addEventListener('click', () => {
  connectedApi  = null;
  connectedAddr = null;
  adaHandles    = [];
  activeHandle  = null;
  localStorage.removeItem('asc_wallet');
  document.getElementById('ppNameRow')?.remove();
  connectBtn.textContent = 'Connect Wallet';
  connectBtn.classList.remove('connected');
  connectBtn.onclick = openWalletModal;
  closeProfilePanel();
  // Reset panel state
  document.getElementById('ppBalance').innerHTML = '<span class="pp-bal-loading">Loading…</span>';
  document.getElementById('ascNftGrid').innerHTML = '<div class="pp-empty">Connect a wallet to see your credentials</div>';
  document.getElementById('allNftGrid').innerHTML = '<div class="pp-empty">—</div>';
  document.getElementById('ascNftCount').textContent = '—';
  document.getElementById('allNftCount').textContent = '—';
  document.getElementById('ppTier').textContent = 'Seeker';
});

/* ── ADA Handle lookup ── */

let adaHandles    = [];  // all handles found in wallet
let activeHandle  = null; // currently displayed handle (null = show address)

function hexToAscii(hex) {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return str;
}

async function loadAdaHandle() {
  if (BLOCKFROST_PROJECT_ID.includes('YOUR_KEY')) return;
  try {
    const info = await blockfrostFetch(`/addresses/${connectedAddr}`);
    adaHandles = (info.amount || [])
      .filter(a => a.unit.startsWith(ADA_HANDLE_POLICY) && a.unit.length > 56)
      .map(a => '$' + hexToAscii(a.unit.slice(56)));

    if (adaHandles.length > 0) {
      activeHandle = adaHandles[0];
      renderHandleUI();
    }
  } catch (e) {
    // no handles or fetch failed — stay with address
  }
}

function renderHandleUI() {
  const addrEl  = document.getElementById('ppAddress');
  const nameRow = document.getElementById('ppNameRow');

  if (activeHandle) {
    addrEl.textContent = activeHandle;
    addrEl.style.fontFamily = 'inherit';
    addrEl.style.fontSize   = '15px';
    addrEl.style.fontWeight = '700';
    addrEl.style.color      = 'var(--blue-600)';
    connectBtn.textContent  = activeHandle;
  } else {
    addrEl.textContent = shortAddr(connectedAddr);
    addrEl.style.fontFamily = "'Courier New', monospace";
    addrEl.style.fontSize   = '13px';
    addrEl.style.fontWeight = '600';
    addrEl.style.color      = 'var(--slate-900)';
    connectBtn.textContent  = shortAddr(connectedAddr);
  }

  // Build the toggle row (only once)
  if (!nameRow) {
    const row = document.createElement('div');
    row.id = 'ppNameRow';
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center;';

    // Handle pill(s)
    adaHandles.forEach(handle => {
      const pill = document.createElement('button');
      pill.className  = 'handle-pill' + (handle === activeHandle ? ' active' : '');
      pill.textContent = handle;
      pill.title = 'Use as display name';
      pill.addEventListener('click', () => {
        activeHandle = handle;
        renderHandleUI();
        document.querySelectorAll('.handle-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        document.querySelector('.addr-pill')?.classList.remove('active');
      });
      row.appendChild(pill);
    });

    // Address pill
    const addrPill = document.createElement('button');
    addrPill.className   = 'addr-pill handle-pill' + (activeHandle ? '' : ' active');
    addrPill.textContent = shortAddr(connectedAddr);
    addrPill.title = 'Show wallet address';
    addrPill.addEventListener('click', () => {
      activeHandle = null;
      renderHandleUI();
      document.querySelectorAll('.handle-pill').forEach(p => p.classList.remove('active'));
      addrPill.classList.add('active');
    });
    row.appendChild(addrPill);

    // Insert below the address line
    document.getElementById('ppAddress').insertAdjacentElement('afterend', row);
  } else {
    // Update active states on existing pills
    nameRow.querySelectorAll('.handle-pill:not(.addr-pill)').forEach(p => {
      p.classList.toggle('active', p.textContent === activeHandle);
    });
    const addrPill = nameRow.querySelector('.addr-pill');
    if (addrPill) addrPill.classList.toggle('active', !activeHandle);
  }
}

/* ── load data ── */

async function loadProfileData() {
  loadAdaHandle();

  // Balance from wallet API directly (no Blockfrost needed)
  try {
    const balanceHex = await connectedApi.getBalance();
    // CBOR-encoded lovelace: simple case is just a hex int
    // Use a basic decode for the common single-asset case
    const balEl = document.getElementById('ppBalance');
    const lovelace = cborDecodeLovelace(balanceHex);
    balEl.textContent = '₳ ' + lovelaceToAda(lovelace);
  } catch (e) {
    document.getElementById('ppBalance').textContent = '₳ —';
  }

  // NFTs — requires Blockfrost
  if (BLOCKFROST_PROJECT_ID.includes('YOUR_KEY')) {
    loadNftsMock();
    return;
  }

  try {
    await loadNftsBlockfrost();
  } catch (e) {
    console.warn('Blockfrost NFT fetch failed:', e);
    loadNftsMock();
  }
}

/* Minimal CBOR lovelace decode — handles Value = int or [int, multiasset] */
function cborDecodeLovelace(hex) {
  // If the value is a simple integer CBOR (starts with 1a/1b or small int)
  const bytes = hex.match(/.{1,2}/g).map(b => parseInt(b, 16));
  let i = 0;
  function readUint() {
    const b = bytes[i++];
    const mt = b >> 5;
    const ai = b & 0x1f;
    if (mt !== 0 && mt !== 2) {
      // It's an array (Value = [coin, multiasset]) — skip array header, read coin
      if (mt === 4) { i = 0; const _ = bytes[i++] & 0x1f; return readUint(); }
    }
    if (ai < 24) return ai;
    if (ai === 24) return bytes[i++];
    if (ai === 25) { const v = (bytes[i] << 8) | bytes[i+1]; i+=2; return v; }
    if (ai === 26) { const v = (bytes[i]<<24)|(bytes[i+1]<<16)|(bytes[i+2]<<8)|bytes[i+3]; i+=4; return v; }
    if (ai === 27) {
      const hi = (bytes[i]<<24)|(bytes[i+1]<<16)|(bytes[i+2]<<8)|bytes[i+3]; i+=4;
      const lo = (bytes[i]<<24)|(bytes[i+1]<<16)|(bytes[i+2]<<8)|bytes[i+3]; i+=4;
      return hi * 4294967296 + lo;
    }
    return 0;
  }
  return readUint();
}

/* ── NFTs via Blockfrost ── */

async function loadNftsBlockfrost() {
  // Convert hex address to bech32 using Blockfrost addresses endpoint
  const addrInfo = await blockfrostFetch(`/addresses/${connectedAddr}`);
  const assets   = await blockfrostFetch(`/addresses/${connectedAddr}/utxos`);

  const allNfts = [];
  // Collect unique policy+asset combos
  const seen = new Set();
  for (const utxo of assets) {
    for (const amt of utxo.amount) {
      if (amt.unit === 'lovelace') continue;
      if (seen.has(amt.unit)) continue;
      seen.add(amt.unit);
      allNfts.push(amt.unit);
    }
  }

  document.getElementById('allNftCount').textContent = allNfts.length;

  // Fetch metadata for first 12
  const meta = await Promise.allSettled(
    allNfts.slice(0, 12).map(unit => blockfrostFetch(`/assets/${unit}`))
  );

  const resolved = meta
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  renderNftGrid('allNftGrid', resolved);

  // Ascendant NFTs: filter by our policy (placeholder policy)
  const ASC_POLICY = 'ascendant_policy_placeholder';
  const ascNfts = resolved.filter(a => a.policy_id === ASC_POLICY);
  document.getElementById('ascNftCount').textContent = ascNfts.length;
  renderNftGrid('ascNftGrid', ascNfts, true);
  updateTier(ascNfts.length);
}

/* ── Mock data (shown when no Blockfrost key yet) ── */

function loadNftsMock() {
  const mockAsc = [
    { display_name: 'Keymaster NFT',  onchain_metadata: { image: null }, emoji: '🔑' },
    { display_name: 'Staker NFT',     onchain_metadata: { image: null }, emoji: '🌱' },
  ];
  const mockAll = [
    ...mockAsc,
    { display_name: 'CNFT #4821',     onchain_metadata: { image: null }, emoji: '🖼️' },
    { display_name: 'SpaceBud #001',  onchain_metadata: { image: null }, emoji: '🚀' },
    { display_name: 'Clay #1234',     onchain_metadata: { image: null }, emoji: '🏺' },
  ];

  document.getElementById('ascNftCount').textContent = mockAsc.length;
  document.getElementById('allNftCount').textContent = mockAll.length;
  renderNftGrid('ascNftGrid', mockAsc, true);
  renderNftGrid('allNftGrid', mockAll);
  updateTier(mockAsc.length);

  // Add a subtle note that this is demo data
  const note = document.createElement('p');
  note.style.cssText = 'font-size:11px;color:var(--slate-300);margin-top:8px;text-align:center;grid-column:1/-1';
  note.textContent = 'Add a Blockfrost key to see your real NFTs';
  document.getElementById('allNftGrid').appendChild(note);
}

function renderNftGrid(gridId, nfts, isAscendant = false) {
  const grid = document.getElementById(gridId);
  if (!nfts || nfts.length === 0) {
    grid.innerHTML = `<div class="pp-empty">${isAscendant ? 'No Ascendant credentials yet' : 'No NFTs found'}</div>`;
    return;
  }
  grid.innerHTML = nfts.map(nft => {
    const name  = nft.display_name || nft.asset_name || 'NFT';
    const img   = nft.onchain_metadata?.image;
    const emoji = nft.emoji || '🖼️';
    const inner = img
      ? `<img src="${ipfsToHttp(img)}" alt="${name}" loading="lazy">`
      : `<div class="nft-card-placeholder">${emoji}</div>`;
    return `<div class="nft-card" title="${name}">${inner}<div class="nft-card-label">${name}</div></div>`;
  }).join('');
}

function ipfsToHttp(uri) {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + uri.slice(7);
  return uri;
}

function updateTier(ascNftCount) {
  const tierEl = document.getElementById('ppTier');
  if      (ascNftCount >= 10) { tierEl.textContent = 'Architect'; tierEl.style.background = 'var(--violet-50)'; tierEl.style.color = 'var(--violet-700)'; }
  else if (ascNftCount >= 5)  { tierEl.textContent = 'Builder';   tierEl.style.background = 'var(--green-50)';  tierEl.style.color = 'var(--green-700)'; }
  else                        { tierEl.textContent = 'Seeker';    tierEl.style.background = 'var(--blue-50)';   tierEl.style.color = 'var(--blue-600)'; }
}

/* ── wire up initial connect button ── */
connectBtn.addEventListener('click', openWalletModal);

/* ── auto-reconnect on page load ── */
(async () => {
  const savedKey = localStorage.getItem('asc_wallet');
  if (!savedKey) return;
  // Wait briefly for wallet extensions to inject into window.cardano
  await new Promise(r => setTimeout(r, 400));
  if (!window.cardano?.[savedKey]) { localStorage.removeItem('asc_wallet'); return; }
  try {
    const walletHandle = window.cardano[savedKey];
    connectedApi = await walletHandle.enable();
    const changeAddrHex = await connectedApi.getChangeAddress();
    connectedAddr = cborHexToAddress(changeAddrHex);
    connectBtn.textContent = shortAddr(connectedAddr);
    connectBtn.classList.add('connected');
    connectBtn.onclick = openProfilePanel;
  } catch {
    localStorage.removeItem('asc_wallet');
  }
})();

/* ═══ END WALLET CONNECTION ═══ */

/* Parallax on hero background mark */
const mark = document.getElementById('parallaxMark');
window.addEventListener('scroll', () => {
  if (mark) {
    mark.style.transform = `translate(-50%, calc(-50% + ${window.scrollY * 0.3}px))`;
  }
}, { passive: true });

/* Fade-up on scroll via IntersectionObserver */
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.fade-up').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 4) * 0.08}s`;
  observer.observe(el);
});

/* Epoch countdown timer */
const epochEnd = Date.now() + (3 * 86400 + 14 * 3600 + 22 * 60) * 1000;

function updateTimer() {
  const timerEl = document.querySelector('.epoch-timer .big');
  if (!timerEl) return;
  const diff = Math.max(0, Math.floor((epochEnd - Date.now()) / 1000));
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  timerEl.textContent = `${d}d ${h}h ${m}m`;
}

updateTimer();
setInterval(updateTimer, 60000);

/* Wallet address copy */
const walletEl = document.querySelector('.wallet-addr');
if (walletEl) {
  walletEl.addEventListener('click', function () {
    const addr = 'addr1qx8f3gk2m9vn4j4kp9d';
    navigator.clipboard?.writeText(addr).catch(() => {});
    this.textContent = '✓ Address copied!';
    setTimeout(() => {
      this.textContent = 'addr1qx8f3gk2m9vn4j…4kp9d → View on Cardanoscan ↗';
    }, 2000);
  });
}

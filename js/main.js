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

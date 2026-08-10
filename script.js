/* ==========================================================
   script.js — shared/global behavior for every page.
   Loads nav.html / footer.html / marquee.html into the page
   via fetch(), then wires up the site-wide widgets (loader,
   mobile menu, active nav link, popups).

   Page-specific behavior (e.g. addToCalendar on the home page,
   toggleText on speakers.html, submitForm on contact.html, the
   accommodation booking flow on accommodation.html) stays as a
   small inline <script> on that page — it isn't in this file.

   NOTE: because this uses fetch() to load the partials, it needs
   to run over http(s), not file://. Locally, run a simple server,
   e.g. `python3 -m http.server` or the VS Code "Live Server"
   extension, then open http://localhost:PORT/index.html.
   On GitHub Pages this works out of the box.
   ========================================================== */

async function loadInclude(placeholderId, url) {
    const el = document.getElementById(placeholderId);
    if (!el) return;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        el.innerHTML = await res.text();
    } catch (err) {
        console.error('Failed to load include:', url, err);
    }
}

async function loadIncludesAndInit() {
    await Promise.all([
        loadInclude('marquee-placeholder', 'marquee.html'),
        loadInclude('nav-placeholder', 'nav.html'),
        loadInclude('footer-placeholder', 'footer.html'),
    ]);

    initLoader();
    initMobileMenu();
    initActiveNavLink();
    initBrochurePopup();
    initJuly5Popup();

    // Let page-specific inline scripts know includes are ready
    // (e.g. if they need to query something inside nav/footer).
    document.dispatchEvent(new CustomEvent('includesReady'));
}

document.addEventListener('DOMContentLoaded', loadIncludesAndInit);

/* ---------------- Loader ---------------- */
function initLoader() {
    const loader = document.getElementById('loader');
    if (!loader) return;
    const hide = () => loader.classList.add('hide');
    if (document.readyState === 'complete') {
        hide();
    } else {
        window.addEventListener('load', hide);
    }
}

/* ---------------- Mobile menu ---------------- */
function initMobileMenu() {
    const menuBtn = document.getElementById('menuBtn');
    const mobileMenu = document.getElementById('mobileMenu');
    if (!menuBtn || !mobileMenu) return;

    menuBtn.addEventListener('click', () => {
        mobileMenu.classList.toggle('active');
    });

    // Close the mobile menu once a real link is followed
    mobileMenu.querySelectorAll('a[href]:not([href="#"])').forEach(link => {
        link.addEventListener('click', () => mobileMenu.classList.remove('active'));
    });
}

// Used by the "Committee" mobile submenu toggle (kept as onclick in nav.html)
function toggleMobileDropdown(event) {
    event.preventDefault();
    const parent = event.target.closest('.mobile-dropdown');
    if (parent) parent.classList.toggle('active');
}

/* ---------------- Active nav link ---------------- */
function initActiveNavLink() {
    let current = location.pathname.split('/').pop();
    if (current === '') current = 'index.html';

    document.querySelectorAll('.nav-links a[href], .mobile-menu a[href], .dropdown-content1 a[href]').forEach(link => {
        if (link.getAttribute('href') === current) {
            link.classList.add('active');
        }
    });
}

/* ---------------- Brochure popup ---------------- */
function initBrochurePopup() {
    const popup = document.getElementById('brochurePopup');
    const closeBtn = document.querySelector('.brochure-close');
    if (!popup) return;

    // Show popup 1 second after load, on every page
    setTimeout(() => popup.classList.remove('hidden'), 1000);

    function closePopup() {
        popup.classList.add('hidden');
    }

    if (closeBtn) closeBtn.addEventListener('click', closePopup);

    popup.addEventListener('click', (e) => {
        if (e.target === popup) closePopup();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePopup();
    });
}

/* ---------------- July 5th popup ---------------- */
// function initJuly5Popup() {
//     const popup = document.getElementById('july5-popup');
//     if (!popup) return;
//     const today = new Date();
//     if (today.getMonth() === 6 && today.getDate() === 4) {
//         popup.style.display = 'flex';
//     }
// }

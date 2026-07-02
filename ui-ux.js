/* ============================================================
   MR Chat — Shared UI/UX Helpers (v3)
   Button loading states, lazy image loading, smooth scroll,
   page fade-in, toast helper improvements.
   ============================================================ */

// ==================== BUTTON LOADING STATE ====================
// Wraps a button to show spinner during async operation.
// Prevents double-click.
window.withButtonLoading = function(btn, asyncFn) {
    if (!btn || btn.classList.contains('btn-loading')) return Promise.resolve();
    const originalHTML = btn.innerHTML;
    btn.classList.add('btn-loading');
    btn.disabled = true;
    return Promise.resolve(asyncFn())
        .finally(() => {
            btn.classList.remove('btn-loading');
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        });
};

// ==================== LAZY IMAGE LOADING ====================
// Usage: <img data-src="..." class="lazy-load">
// Converts to src when image enters viewport (IntersectionObserver)
window.initLazyImages = function() {
    if (!('IntersectionObserver' in window)) {
        // Fallback: load all immediately
        document.querySelectorAll('img.lazy-load[data-src]').forEach(img => {
            img.src = img.dataset.src;
            img.classList.add('loaded');
        });
        return;
    }
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
                    img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
                    delete img.dataset.src;
                }
                obs.unobserve(img);
            }
        });
    }, { rootMargin: '100px' });
    document.querySelectorAll('img.lazy-load[data-src]').forEach(img => observer.observe(img));
};

// Re-scan for new lazy images (call after dynamic content insert)
window.refreshLazyImages = function() {
    initLazyImages();
};

// ==================== SMOOTH SCROLL ====================
window.smoothScrollTo = function(el, offset = 0) {
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: 'smooth' });
};

// ==================== PAGE FADE-IN (on DOMContentLoaded) ====================
document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('page-fade-in');
    initLazyImages();
});

// ==================== DEFER NON-CRITICAL JS ====================
// Use: window.deferUntilIdle(() => { ... heavy work ... })
window.deferUntilIdle = function(fn) {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(fn, { timeout: 2000 });
    } else {
        setTimeout(fn, 100);
    }
};

// ==================== DEBOUNCE HELPER ====================
window.debounce = function(fn, delay = 300) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
};

// ==================== TOAST HELPER (improved) ====================
// Auto-dismisses after 3.5s, stacks multiple toasts
window.showToast = window.showToast || function(message, type = 'info', duration = 3500) {
    let toast = document.getElementById('app-notification');
    if (!toast) {
        // Fallback: create temporary toast
        toast = document.createElement('div');
        toast.id = 'app-notification';
        toast.className = 'toast';
        toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 20px;border-radius:12px;font-size:0.85rem;font-weight:600;max-width:340px;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.display = 'none';
    }, duration);
};

// ==================== ERROR BOUNDARY (catches unhandled promise rejections) ====================
window.addEventListener('unhandledrejection', (event) => {
    console.error('[Unhandled rejection]', event.reason);
    // Don't show toast for permission-denied (common in CF calls when not logged in)
    if (event.reason?.code === 'permission-denied') return;
    if (window.showToast) showToast('Something went wrong. Please try again.', 'error');
});

// ==================== PREVENT DOUBLE FORM SUBMISSION ====================
document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.dataset.submitting === 'true') {
        e.preventDefault();
        return;
    }
    form.dataset.submitting = 'true';
    setTimeout(() => { form.dataset.submitting = 'false'; }, 2000);
}, true);

// ==================== NETWORK STATUS INDICATOR ====================
window.addEventListener('online', () => {
    if (window.showToast) showToast('Back online!', 'success', 2000);
});
window.addEventListener('offline', () => {
    if (window.showToast) showToast('You are offline. Some features may not work.', 'warning', 4000);
});

// ==================== LEGAL FOOTER + COOKIE CONSENT ====================
// Inject copyright footer into all pages
window.addEventListener('DOMContentLoaded', () => {
    // Create footer if not exists
    if (!document.getElementById('mr-legal-footer')) {
        const footer = document.createElement('footer');
        footer.id = 'mr-legal-footer';
        footer.style.cssText = 'text-align:center;padding:20px 16px;border-top:1px solid rgba(255,255,255,0.08);margin-top:auto;background:rgba(10,10,15,0.6);backdrop-filter:blur(10px);';
        footer.innerHTML = `
            <div style="font-size:0.72rem;color:#8b8b9e;line-height:1.6;">
                <div style="margin-bottom:6px;">
                    <strong style="color:#FF007F;">MR Chat</strong> <span style="opacity:0.6;">™</span> · A product of <strong style="color:#9D00FF;">MR Group</strong>
                </div>
                <div>
                    © 2025 MR Group. All Rights Reserved.
                </div>
                <div style="margin-top:6px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                    <a href="terms.html" style="color:#8b8b9e;text-decoration:none;">Terms of Service</a>
                    <span style="opacity:0.3;">·</span>
                    <a href="privacy.html" style="color:#8b8b9e;text-decoration:none;">Privacy Policy</a>
                    <span style="opacity:0.3;">·</span>
                    <a href="#" onclick="window.MR_showAbout&&window.MR_showAbout();return false;" style="color:#8b8b9e;text-decoration:none;">About</a>
                </div>
            </div>
        `;
        document.body.appendChild(footer);
    }

    // Cookie consent banner (GDPR)
    if (!localStorage.getItem('mr_cookie_consent')) {
        const banner = document.createElement('div');
        banner.id = 'mr-cookie-banner';
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:linear-gradient(135deg,#1a1a25,#12121a);border-top:1px solid #FF007F;padding:14px 20px;z-index:99998;display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:center;box-shadow:0 -4px 20px rgba(0,0,0,0.5);';
        banner.innerHTML = `
            <div style="flex:1;min-width:250px;font-size:0.78rem;color:#a0a0b0;">
                <i class="fas fa-cookie-bite" style="color:#FF007F;margin-right:6px;"></i>
                MR Chat uses local storage to remember your preferences. No tracking cookies. See our <a href="privacy.html" style="color:#FF007F;">Privacy Policy</a>.
            </div>
            <button id="mr-cookie-accept" style="padding:8px 18px;background:linear-gradient(135deg,#FF007F,#9D00FF);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:0.8rem;">
                Got it
            </button>
        `;
        document.body.appendChild(banner);
        document.getElementById('mr-cookie-accept').addEventListener('click', () => {
            localStorage.setItem('mr_cookie_consent', 'accepted');
            banner.style.transition = 'opacity 0.3s';
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 300);
        });
    }

    // About modal
    window.MR_showAbout = function() {
        let modal = document.getElementById('mr-about-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'mr-about-modal';
            modal.className = 'modal-overlay';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
            modal.innerHTML = `
                <div style="background:linear-gradient(145deg,#1a1a25,#12121a);border:1.5px solid rgba(255,0,127,0.3);border-radius:24px;padding:32px;max-width:380px;width:100%;text-align:center;position:relative;">
                    <button onclick="document.getElementById('mr-about-modal').remove()" style="position:absolute;top:14px;right:14px;background:none;border:none;color:#8b8b9e;font-size:1.2rem;cursor:pointer;">×</button>
                    <div style="font-size:3rem;margin-bottom:12px;">
                        <img src="logo.png" alt="MR Chat" style="width:64px;height:64px;border-radius:50%;margin:0 auto;box-shadow:0 0 20px rgba(255,0,127,0.3);">
                    </div>
                    <h2 style="font-size:1.5rem;font-weight:800;background:linear-gradient(135deg,#FF007F,#9D00FF);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px;">MR Chat</h2>
                    <p style="font-size:0.8rem;color:#8b8b9e;margin-bottom:16px;">Version 3.0 · Build 2025</p>
                    <p style="font-size:0.85rem;color:#a0a0b0;line-height:1.6;margin-bottom:16px;">
                        Secure. Premium. Connected.<br>
                        A product of <strong style="color:#9D00FF;">MR Group</strong>
                    </p>
                    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;">
                        <span style="font-size:0.7rem;padding:4px 10px;background:rgba(255,0,127,0.1);border:1px solid rgba(255,0,127,0.3);border-radius:10px;color:#FF007F;">47 Cloud Functions</span>
                        <span style="font-size:0.7rem;padding:4px 10px;background:rgba(0,230,255,0.1);border:1px solid rgba(0,230,255,0.3);border-radius:10px;color:#00E6FF;">E2E Encryption</span>
                        <span style="font-size:0.7rem;padding:4px 10px;background:rgba(0,255,148,0.1);border:1px solid rgba(0,255,148,0.3);border-radius:10px;color:#00FF94;">PWA Ready</span>
                    </div>
                    <div style="font-size:0.72rem;color:#8b8b9e;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">
                        © 2025 MR Group. All Rights Reserved.<br>
                        MR Chat™ is a trademark of MR Group.
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        }
    };
});

// ==================== PWA INSTALL BANNER (Custom "Download App") ====================
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default browser install prompt
    e.preventDefault();
    deferredPrompt = e;

    // Check if user already dismissed or installed
    if (localStorage.getItem('mr_pwa_install_dismissed') === 'true') return;
    // Check if already running as standalone (installed)
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) return;

    // Show custom banner after 3 seconds
    setTimeout(showInstallBanner, 3000);
});

function showInstallBanner() {
    if (document.getElementById('mr-install-banner')) return;
    if (!deferredPrompt) return;

    const banner = document.createElement('div');
    banner.id = 'mr-install-banner';
    banner.style.cssText = `
        position: fixed; bottom: 0; left: 0; right: 0;
        background: linear-gradient(135deg, #FF007F, #9D00FF);
        color: #fff; padding: 14px 20px; z-index: 99997;
        display: flex; align-items: center; gap: 14px;
        box-shadow: 0 -4px 30px rgba(0,0,0,0.4);
        animation: slideUpBanner 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: 'Inter', sans-serif;
    `;

    banner.innerHTML = `
        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <img src="logo.png" alt="MR Chat" style="width:28px;height:28px;border-radius:50%;">
        </div>
        <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.9rem; font-weight: 800; margin-bottom: 2px;">Download MR Chat App</div>
            <div style="font-size: 0.72rem; opacity: 0.85;">Install for faster access & push notifications</div>
        </div>
        <button id="mr-install-btn" style="
            background: #fff; color: #FF007F; border: none;
            padding: 10px 20px; border-radius: 12px;
            font-weight: 700; font-size: 0.82rem; cursor: pointer;
            white-space: nowrap; transition: transform 0.2s;
        ">Install</button>
        <button id="mr-install-close" style="
            background: rgba(255,255,255,0.2); color: #fff; border: none;
            width: 32px; height: 32px; border-radius: 50%;
            font-size: 1.1rem; cursor: pointer; display: flex;
            align-items: center; justify-content: center; flex-shrink: 0;
            transition: background 0.2s;
        ">×</button>
    `;

    document.body.appendChild(banner);

    // Add animation keyframes if not exists
    if (!document.getElementById('mr-banner-anim')) {
        const style = document.createElement('style');
        style.id = 'mr-banner-anim';
        style.textContent = `
            @keyframes slideUpBanner {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            @keyframes slideDownBanner {
                from { transform: translateY(0); opacity: 1; }
                to { transform: translateY(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    // Install button click
    document.getElementById('mr-install-btn').addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice.outcome === 'accepted') {
                console.log('[PWA] User accepted install');
                banner.style.animation = 'slideDownBanner 0.3s ease forwards';
                setTimeout(() => banner.remove(), 300);
            } else {
                console.log('[PWA] User dismissed install');
            }
            deferredPrompt = null;
        }
    });

    // Close button click
    document.getElementById('mr-install-close').addEventListener('click', () => {
        localStorage.setItem('mr_pwa_install_dismissed', 'true');
        banner.style.animation = 'slideDownBanner 0.3s ease forwards';
        setTimeout(() => banner.remove(), 300);
    });
}

// Detect if app was installed
window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed successfully');
    const banner = document.getElementById('mr-install-banner');
    if (banner) banner.remove();
    localStorage.setItem('mr_pwa_installed', 'true');
});

// ==================== SUPPRESS CLOUD FUNCTION CORS ERRORS (Spark plan) ===
// On Spark plan, callable functions may fail with CORS errors.
// This suppresses the console noise without breaking functionality.
(function() {
    const origError = console.error;
    console.error = function(...args) {
        const msg = args.join(' ');
        // Suppress CORS and Cloud Function connection errors
        if (msg.includes('CORS') || 
            msg.includes('ERR_CONNECTION_CLOSED') || 
            msg.includes('ERR_FAILED') || 
            msg.includes('cloudfunctions.net') ||
            msg.includes('access control check') ||
            msg.includes('No \'Access-Control-Allow-Origin\'')) {
            return; // Silent suppress
        }
        origError.apply(console, args);
    };
})();

/* common.js */

// ─────────────────────────────────────────────
// 0. 자동 로그아웃 모듈
//    · 비활동 30분 경과 시 자동 로그아웃
//    · 만료 2분 전 경고 모달 → "계속하기" 누르면 세션 연장
//    · 탭 전환 후 복귀 시에도 즉시 체크
// ─────────────────────────────────────────────
(function setupAutoLogout() {
    const TIMEOUT_MS  = 30 * 60 * 1000;
    const WARN_MS     =  2 * 60 * 1000;
    const CHECK_MS    =      60 * 1000;
    const STORAGE_KEY = 'quiz_last_active';

    let warnInterval  = null;
    let checkInterval = null;
    let throttleTimer = null;

    function resetActivity() {
        sessionStorage.setItem(STORAGE_KEY, Date.now());
        const warnModal = document.getElementById('auto-logout-modal');
        if (warnModal && warnModal.style.display === 'flex') {
            warnModal.style.display = 'none';
            clearInterval(warnInterval);
        }
    }

    function forceLogout() {
        clearInterval(warnInterval);
        clearInterval(checkInterval);
        sessionStorage.removeItem('quiz_user');
        sessionStorage.removeItem(STORAGE_KEY);
        const warnModal = document.getElementById('auto-logout-modal');
        if (warnModal) warnModal.style.display = 'none';
        const path = location.pathname;
        if (!path.endsWith('index.html') && path !== '/' && path !== '') {
            location.href = 'index.html';
        } else {
            const guestView = document.getElementById('guest-view');
            const userView  = document.getElementById('user-view');
            if (guestView) guestView.style.display = 'block';
            if (userView)  userView.style.display  = 'none';
        }
    }

    function showWarnModal(remainSec) {
        const modal   = document.getElementById('auto-logout-modal');
        const countEl = document.getElementById('auto-logout-count');
        if (!modal) { forceLogout(); return; }
        if (countEl) countEl.innerText = remainSec;
        modal.style.display = 'flex';

        let remain = remainSec;
        warnInterval = setInterval(() => {
            remain -= 1;
            if (countEl) countEl.innerText = remain;
            if (remain <= 0) { clearInterval(warnInterval); forceLogout(); }
        }, 1000);
    }

    function startCheck() {
        clearInterval(checkInterval);
        checkInterval = setInterval(() => {
            if (!sessionStorage.getItem('quiz_user')) { clearInterval(checkInterval); return; }
            const lastActive = parseInt(sessionStorage.getItem(STORAGE_KEY) || Date.now());
            const idle       = Date.now() - lastActive;
            const remain     = TIMEOUT_MS - idle;

            if (remain <= 0) {
                clearInterval(checkInterval);
                forceLogout();
            } else if (remain <= WARN_MS) {
                const modal = document.getElementById('auto-logout-modal');
                if (modal && modal.style.display !== 'flex') {
                    clearInterval(checkInterval);
                    showWarnModal(Math.floor(remain / 1000));
                }
            }
        }, CHECK_MS);
    }

    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (!sessionStorage.getItem('quiz_user')) return;
            if (throttleTimer) return;
            throttleTimer = setTimeout(() => { resetActivity(); throttleTimer = null; }, 30 * 1000);
        }, { passive: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!sessionStorage.getItem('quiz_user')) return;
        const lastActive = parseInt(sessionStorage.getItem(STORAGE_KEY) || Date.now());
        if (Date.now() - lastActive >= TIMEOUT_MS) forceLogout();
    });

    document.addEventListener('DOMContentLoaded', () => {
        if (!sessionStorage.getItem('quiz_user')) return;
        resetActivity();
        startCheck();
    });

    window.extendSession = function () {
        clearInterval(warnInterval);
        resetActivity();
        startCheck();
    };
})();

// ─────────────────────────────────────────────
// 1. 전역 상태 관리
// ─────────────────────────────────────────────
let allQuestions = [];
let currentIndex = 0;
let currentUser  = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };
let currentTargetUserId = null;

// ─────────────────────────────────────────────
// 2. 초기 로드 및 UI 업데이트
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateUserUI();

    if (currentUser.status === 'admin') {
        const adminBtn = document.getElementById('btn-admin-menu');
        if (adminBtn) adminBtn.style.display = 'inline-block';
    }

    // index.html 전용: 이미 로그인된 상태면 user-view 표시
    const guestView = document.getElementById('guest-view');
    const userView  = document.getElementById('user-view');
    if (guestView && userView && currentUser.email) {
        guestView.style.display = 'none';
        userView.style.display  = 'block';
        const infoEl = document.getElementById('user-display-info');
        const displayName = currentUser.name || currentUser.email;
        if (infoEl) infoEl.innerText = `${displayName} (${(currentUser.status || 'free').toUpperCase()})`;
    }

    // ★ [추가] 페이지 로드 시 URL 해시에서 Supabase recovery 토큰 감지
    //   재설정 이메일 링크 클릭 → index.html#access_token=...&type=recovery 형태로 리다이렉트됨
    _checkRecoveryToken();
});

function updateUserUI() {
    const savedUser = sessionStorage.getItem('quiz_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        const nameEl   = document.getElementById('display-name');
        const statusEl = document.getElementById('display-status');
        if (nameEl)   nameEl.innerText   = currentUser.name || currentUser.email;
        if (statusEl) statusEl.innerText = (currentUser.status || 'free').toUpperCase();
    }
}

// ─────────────────────────────────────────────
// 3. 커스텀 모달 제어
// ─────────────────────────────────────────────
window.closeCustomModal = function () {
    const modal = document.getElementById('custom-modal');
    if (modal) modal.style.display = 'none';
};

window.showAlert = function (title, desc) {
    const modal = document.getElementById('custom-modal');
    if (!modal) { alert(`${title}\n${desc}`); return; }

    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-desc').innerText  = desc;
    document.getElementById('modal-date-input').style.display = 'none';
    document.getElementById('modal-cancel-btn').style.display = 'none';

    const confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.onclick = closeCustomModal;
    modal.style.display = 'flex';
};

// ─────────────────────────────────────────────
// 4. 인증 — 로그인 / 회원가입 / 로그아웃
//         / 비밀번호 재설정 발송 / 새 비밀번호 저장
// ─────────────────────────────────────────────

window.handleLogin = async function () {
    const email    = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;

    if (!email || !password) return showAlert('입력 오류', '이메일과 비밀번호를 입력해주세요.');

    try {
        const res  = await fetch('/api/login', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        const userData = {
            id    : data.user.id,
            email : data.user.email,
            name  : data.user.name || '',
            status: data.status
        };
        sessionStorage.setItem('quiz_user', JSON.stringify(userData));
        currentUser = userData;
        sessionStorage.setItem('quiz_last_active', Date.now());

        const guestView = document.getElementById('guest-view');
        const userView  = document.getElementById('user-view');
        if (guestView && userView) {
            guestView.style.display = 'none';
            userView.style.display  = 'block';
            const infoEl = document.getElementById('user-display-info');
            if (infoEl) infoEl.innerText = `${data.user.name || data.user.email} (${data.status.toUpperCase()})`;
            if (data.status === 'admin') {
                const adminBtn = document.getElementById('btn-admin-menu');
                if (adminBtn) adminBtn.style.display = 'inline-block';
            }
        } else {
            location.href = 'premium.html';
        }
    } catch (e) {
        showAlert('로그인 실패', e.message);
    }
};

window.handleSignUp = async function () {
    const name     = document.getElementById('signup-name')?.value.trim();
    const email    = document.getElementById('signup-email')?.value.trim();
    const password = document.getElementById('signup-password')?.value;

    if (!name)              return showAlert('입력 오류', '이름을 입력해주세요.');
    if (name.length > 20)   return showAlert('입력 오류', '이름은 20자 이내로 입력해주세요.');
    if (!email || !password) return showAlert('입력 오류', '이메일과 비밀번호를 입력해주세요.');
    if (password.length < 6) return showAlert('입력 오류', '비밀번호는 6자 이상이어야 합니다.');

    try {
        const res  = await fetch('/api/signup', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ name, email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        showAlert('가입 완료', data.message);
    } catch (e) {
        showAlert('가입 실패', e.message);
    }
};

window.handleLogout = function () {
    const modal = document.getElementById('custom-modal');
    if (!modal) {
        if (confirm('정말 로그아웃 하시겠습니까?')) {
            sessionStorage.removeItem('quiz_user');
            sessionStorage.removeItem('quiz_last_active');
            location.href = 'index.html';
        }
        return;
    }
    document.getElementById('modal-title').innerText = '로그아웃';
    document.getElementById('modal-desc').innerText  = '정말 로그아웃 하시겠습니까?';
    document.getElementById('modal-date-input').style.display = 'none';
    document.getElementById('modal-cancel-btn').style.display = 'inline-block';
    document.getElementById('modal-confirm-btn').onclick = () => {
        sessionStorage.removeItem('quiz_user');
        sessionStorage.removeItem('quiz_last_active');
        location.href = 'index.html';
    };
    modal.style.display = 'flex';
};

// ─────────────────────────────────────────────
// 4-A. ★ [추가] 비밀번호 재설정 이메일 발송
// ─────────────────────────────────────────────
// · Supabase /auth/v1/recover 직접 호출 (서버 파일 불필요)
// · SUPABASE_URL / SUPABASE_ANON_KEY 는 공개 허용 값
//   (민감한 Service Role Key와 다릅니다)
// ★ 아래 두 상수를 본인 Supabase 프로젝트 값으로 반드시 교체하세요.
//   Supabase 대시보드 → Project Settings → API 에서 확인
const _SUPABASE_URL      = 'https://iszsnxeprdtznvpbmmax.supabase.co'; // ← 교체 필요
const _SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzenNueGVwcmR0em52cGJtbWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NTkzOTIsImV4cCI6MjA5MTUzNTM5Mn0.Vcq7X54leFA7tEr1ADj6NQ48hBjCcYPf_kkiZHUeO9g';                        // ← 교체 필요

window.handleResetPassword = async function () {
    const email = document.getElementById('reset-email')?.value.trim();
    if (!email) return showAlert('입력 오류', '이메일을 입력해주세요.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return showAlert('입력 오류', '올바른 이메일 형식을 입력해주세요.');

    const btn = document.getElementById('btn-send-reset');
    if (btn) { btn.disabled = true; btn.textContent = '발송 중...'; }

    // 재설정 완료 후 돌아올 URL — Supabase 대시보드 URL Configuration의 Redirect URL과 일치해야 함
    const redirectTo = `${location.origin}/index.html`;

    try {
        const res = await fetch(`${_SUPABASE_URL}/auth/v1/recover`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': _SUPABASE_ANON_KEY },
            body   : JSON.stringify({ email, gotrue_meta_security: {}, redirect_to: redirectTo })
        });

        // Supabase 보안 정책: 이메일 존재 여부와 무관하게 항상 200 반환
        if (res.ok || res.status === 200) {
            // 모달로 안내 후 [확인] 클릭 시 로그인 탭으로 이동
            const modal = document.getElementById('custom-modal');
            if (modal) {
                document.getElementById('modal-title').innerText = '📧 메일 발송 완료';
                document.getElementById('modal-desc').innerText  =
                    `${email}로 재설정 링크를 발송했습니다.\n\n` +
                    '이메일함(스팸함 포함)을 확인해주세요.\n' +
                    '링크는 1시간 후 만료됩니다.';
                document.getElementById('modal-date-input').style.display = 'none';
                document.getElementById('modal-cancel-btn').style.display = 'none';
                document.getElementById('modal-confirm-btn').onclick = () => {
                    closeCustomModal();
                    if (typeof switchTab === 'function') switchTab('login');
                };
                modal.style.display = 'flex';
            }
        } else {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.msg || err.message || '요청 실패');
        }
    } catch (e) {
        showAlert('오류', '잠시 후 다시 시도해주세요.\n(' + e.message + ')');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '재설정 링크 발송'; }
    }
};

// ─────────────────────────────────────────────
// 4-B. ★ [추가] URL 해시에서 recovery 토큰 감지
// ─────────────────────────────────────────────
// Supabase가 재설정 링크 클릭 후 리다이렉트하는 URL 형식:
//   https://your-app.vercel.app/index.html
//   #access_token=XXX&refresh_token=YYY&type=recovery
//
// · type=recovery 확인 → 새 비밀번호 폼으로 자동 전환
// · access_token을 sessionStorage에 임시 저장 → 비밀번호 변경 시 사용
// · 보안: URL 해시는 서버로 전송되지 않으므로 토큰 노출 위험 없음
function _checkRecoveryToken() {
    const hash   = location.hash;          // "#access_token=...&type=recovery"
    if (!hash || !hash.includes('type=recovery')) return;

    // URL 해시 파싱
    const params       = new URLSearchParams(hash.replace('#', ''));
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const tokenType    = params.get('type');         // 'recovery'

    if (tokenType !== 'recovery' || !accessToken) return;

    // 토큰을 임시 보관 (비밀번호 변경 API 호출에 사용)
    sessionStorage.setItem('recovery_access_token',  accessToken);
    sessionStorage.setItem('recovery_refresh_token', refreshToken || '');

    // URL 해시 제거 (뒤로가기로 재진입 방지)
    history.replaceState(null, '', location.pathname);

    // 로그인된 상태이면 먼저 로그아웃 처리 (다른 계정으로 변경하는 경우 대비)
    sessionStorage.removeItem('quiz_user');
    sessionStorage.removeItem('quiz_last_active');

    // 로그인 뷰로 전환 후 새 비밀번호 폼 표시
    const guestView = document.getElementById('guest-view');
    const userView  = document.getElementById('user-view');
    if (guestView) guestView.style.display = 'block';
    if (userView)  userView.style.display  = 'none';

    if (typeof switchTab === 'function') {
        switchTab('new-password');
    }
}

// ─────────────────────────────────────────────
// 4-C. ★ [추가] 새 비밀번호 저장
// ─────────────────────────────────────────────
// · sessionStorage에 임시 저장된 access_token으로 Supabase /auth/v1/user PATCH 호출
// · 성공 시 토큰 삭제 → 로그인 탭으로 이동
window.handleSetNewPassword = async function () {
    const newPw      = document.getElementById('new-password')?.value;
    const confirmPw  = document.getElementById('new-password-confirm')?.value;
    const token      = sessionStorage.getItem('recovery_access_token');

    if (!newPw)            return showAlert('입력 오류', '새 비밀번호를 입력해주세요.');
    if (newPw.length < 6)  return showAlert('입력 오류', '비밀번호는 6자 이상이어야 합니다.');
    if (newPw !== confirmPw) return showAlert('입력 오류', '비밀번호가 일치하지 않습니다.\n다시 확인해주세요.');
    if (!token)            return showAlert('오류', '인증 토큰이 없습니다.\n재설정 이메일 링크를 다시 클릭해주세요.');

    const btn = document.getElementById('btn-set-password');
    if (btn) { btn.disabled = true; btn.textContent = '변경 중...'; }

    try {
        // Supabase REST API: 비밀번호 업데이트
        // Authorization 헤더에 access_token 전달
        const res = await fetch(`${_SUPABASE_URL}/auth/v1/user`, {
            method : 'PUT',
            headers: {
                'Content-Type' : 'application/json',
                'apikey'       : _SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ password: newPw })
        });

        if (res.ok) {
            // 임시 토큰 삭제
            sessionStorage.removeItem('recovery_access_token');
            sessionStorage.removeItem('recovery_refresh_token');

            // 성공 모달 → [확인] 클릭 시 로그인 탭으로 이동
            const modal = document.getElementById('custom-modal');
            if (modal) {
                document.getElementById('modal-title').innerText = '✅ 변경 완료';
                document.getElementById('modal-desc').innerText  =
                    '비밀번호가 성공적으로 변경되었습니다.\n새 비밀번호로 로그인해주세요.';
                document.getElementById('modal-date-input').style.display = 'none';
                document.getElementById('modal-cancel-btn').style.display = 'none';
                document.getElementById('modal-confirm-btn').onclick = () => {
                    closeCustomModal();
                    if (typeof switchTab === 'function') switchTab('login');
                };
                modal.style.display = 'flex';
            }
        } else {
            const errData = await res.json().catch(() => ({}));
            // 토큰 만료(1시간) 에러 처리
            if (res.status === 401 || (errData.msg || '').includes('expired')) {
                sessionStorage.removeItem('recovery_access_token');
                sessionStorage.removeItem('recovery_refresh_token');
                showAlert(
                    '링크 만료',
                    '재설정 링크가 만료되었습니다.(유효시간 1시간)\n' +
                    '"비밀번호 재설정" 을 다시 요청해주세요.'
                );
                document.getElementById('modal-confirm-btn').onclick = () => {
                    closeCustomModal();
                    if (typeof switchTab === 'function') switchTab('reset');
                };
            } else {
                throw new Error(errData.msg || errData.message || '비밀번호 변경 실패');
            }
        }
    } catch (e) {
        showAlert('오류', e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '비밀번호 변경 완료'; }
    }
};

// ─────────────────────────────────────────────
// 5. 퀴즈 엔진
// ─────────────────────────────────────────────
window.loadQuestions = async function () {
    if (!currentUser?.email) {
        showAlert('인증 필요', '로그인 후 이용해주세요.');
        return;
    }
    const area = document.getElementById('question-area');
    if (area) area.innerHTML = '<div style="text-align:center; padding:50px;">데이터 로드 중...</div>';

    const payload = {
        grade     : document.getElementById('sel-grade')?.value,
        category  : document.getElementById('sel-category')?.value,
        year      : document.getElementById('sel-year')?.value,
        limit     : parseInt(document.getElementById('sel-limit')?.value || 20),
        userStatus: currentUser.status
    };

    try {
        const response = await fetch('/api/questions', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify(payload)
        });
        allQuestions = await response.json();
        currentIndex = 0;
        renderQuestion();
    } catch (e) {
        if (area) area.innerHTML = '<div style="text-align:center; padding:50px;">불러오기 실패</div>';
    }
};

function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area || allQuestions.length === 0) {
        if (area) area.innerHTML = '<div class="card" style="text-align:center; padding:50px;">해당 조건의 문제가 없습니다.</div>';
        return;
    }
    const q           = allQuestions[currentIndex];
    const displayYear = q.exam_date ? String(q.exam_date).substring(0, 4) + '년' : '';

    area.innerHTML = `
        <div class="card">
            <div class="card-header-info">
                <span>문제 ${currentIndex + 1} / ${allQuestions.length}</span>
                <span>${q.category || ''} ${displayYear ? '(' + displayYear + ')' : ''}</span>
            </div>
            <div class="card-question">${q.question}</div>
            <div class="choices">
                ${[1,2,3,4].map(num => `
                    <button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})">
                        <span class="choice-num">${num}</span>
                        <span class="choice-text">${q['choice' + num]}</span>
                    </button>
                `).join('')}
            </div>
            <div id="result-box" class="result-box" style="display:none; margin-top:25px; text-align:center;"></div>
            <div class="card-footer">
                <button class="btn-nav" onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
                <button class="btn-nav active" onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
            </div>
        </div>
    `;
}

window.checkAnswer = function (selected) {
    const q         = allQuestions[currentIndex];
    const correct   = q.answer;
    const resultBox = document.getElementById('result-box');
    document.querySelectorAll('.choice-btn').forEach(btn => btn.style.pointerEvents = 'none');

    let resultHTML = '';
    if (selected == correct) {
        document.getElementById(`choice-${selected}`).style.borderColor     = '#2ecc71';
        document.getElementById(`choice-${selected}`).style.backgroundColor = '#eafaf2';
        resultHTML = `<div style="color:#2ecc71;font-weight:800;font-size:1.2rem;margin-bottom:10px;">✅ 정답입니다!</div>`;
    } else {
        document.getElementById(`choice-${selected}`).style.borderColor     = '#e74c3c';
        document.getElementById(`choice-${selected}`).style.backgroundColor = '#fdf0ee';
        document.getElementById(`choice-${correct}`).style.borderColor      = '#2ecc71';
        document.getElementById(`choice-${correct}`).style.backgroundColor  = '#f0fff4';
        resultHTML = `<div style="color:#e74c3c;font-weight:800;font-size:1.2rem;margin-bottom:10px;">❌ 오답입니다.</div>
                      <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-bottom:15px;">정답은 <strong>${correct}번</strong> 입니다.</div>`;
    }
    if (q.explanation) {
        resultHTML += `
            <div style="text-align:left;background:#f0f4ff;border-left:4px solid #364d79;padding:15px;border-radius:8px;margin-top:15px;">
                <strong>💡 해설:</strong><br>${q.explanation}
            </div>`;
    }
    resultBox.innerHTML     = resultHTML;
    resultBox.style.display = 'block';
};

window.changeQuestion = function (step) {
    currentIndex += step;
    renderQuestion();
};

// ─────────────────────────────────────────────
// 6. 관리자 기능 (원본 로직 유지)
// ─────────────────────────────────────────────
window.toggleAdminPanel = function () {
    const adminPanel   = document.getElementById('admin-panel');
    const filterBar    = document.querySelector('.filter-bar');
    const questionArea = document.getElementById('question-area');
    const adminBtn     = document.getElementById('btn-admin-menu');
    const isOpening    = adminPanel.style.display === 'none';

    if (isOpening) {
        adminPanel.style.display = 'block';
        if (filterBar)    filterBar.style.display    = 'none';
        if (questionArea) questionArea.style.display = 'none';
        adminBtn.innerText = '✕ 대시보드 닫기';
        loadAdminStats();
        loadUserList();
    } else {
        adminPanel.style.display = 'none';
        if (filterBar)    filterBar.style.display    = 'flex';
        if (questionArea) questionArea.style.display = 'block';
        adminBtn.innerText = '📊 통계 대시보드';
    }
};

async function loadAdminStats() {
    try {
        const response = await fetch('/api/admin/stats', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ userStatus: currentUser.status })
        });
        const stats = await response.json();
        document.getElementById('stat-total-questions').innerText = (stats.totalQuestions || 0).toLocaleString();
        document.getElementById('stat-today-users').innerText     = (stats.activeUsers || 0).toLocaleString();
        document.getElementById('stat-premium-rate').innerText    = (stats.premiumRate || 0) + '%';
    } catch (e) { console.error('통계 실패', e); }
}

async function loadUserList() {
    try {
        const response = await fetch('/api/admin/users', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ userStatus: currentUser.status })
        });
        const users = await response.json();
        const tbody = document.getElementById('user-list-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        users.forEach(user => {
            const tr            = document.createElement('tr');
            const uStatus       = user.user_status || 'free';
            const expiryDisplay = user.expiry_date ? user.expiry_date.split('T')[0] : '-';
            tr.innerHTML = `
                <td style="text-align:left; padding-left:15px;">${user.email}</td>
                <td style="text-align:center;"><span class="badge-${uStatus}">${uStatus.toUpperCase()}</span></td>
                <td style="text-align:center;">${expiryDisplay}</td>
                <td style="text-align:center;">
                    <select onchange="updateUserStatus('${user.id}', this.value)" style="padding:4px; border-radius:4px;">
                        <option value="free"    ${uStatus==='free'    ? 'selected':''}>FREE</option>
                        <option value="premium" ${uStatus==='premium' ? 'selected':''}>PREMIUM</option>
                        <option value="admin"   ${uStatus==='admin'   ? 'selected':''}>ADMIN</option>
                    </select>
                    <button onclick="setExpiryDate('${user.id}')" style="background:none;border:none;cursor:pointer;">📅</button>
                    <button onclick="deleteUser('${user.id}','${user.email}')" style="background:none;border:none;cursor:pointer;color:#e74c3c;margin-left:5px;">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) { console.error('유저 목록 로드 실패', e); }
}

window.refreshAdminDashboard = async function () {
    const btn = document.querySelector('.btn-refresh-stats');
    if (btn) btn.innerText = '로딩 중...';
    await loadAdminStats();
    await loadUserList();
    if (btn) btn.innerText = '🔄 데이터 새로고침';
};

// ─────────────────────────────────────────────
// 7. 등급 / 기한 / 삭제 (원본 로직 유지)
// ─────────────────────────────────────────────
window.updateUserStatus = function (userId, newStatus) {
    const modal      = document.getElementById('custom-modal');
    const dateInput  = document.getElementById('modal-date-input');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    document.getElementById('modal-cancel-btn').style.display = 'inline-block';

    if (newStatus === 'premium') {
        document.getElementById('modal-title').innerText = 'Premium 기한 설정';
        document.getElementById('modal-desc').innerText  = '만료일을 선택해 주세요.';
        dateInput.style.display = 'block';
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        dateInput.value = nextMonth.toISOString().split('T')[0];
        confirmBtn.onclick = () => { if (!dateInput.value) return; executeStatusUpdate(userId, newStatus, dateInput.value); };
    } else {
        document.getElementById('modal-title').innerText = '등급 변경';
        document.getElementById('modal-desc').innerText  = `${newStatus.toUpperCase()} 등급으로 변경하시겠습니까?`;
        dateInput.style.display = 'none';
        confirmBtn.onclick = () => executeStatusUpdate(userId, newStatus, null);
    }
    modal.style.display = 'flex';
};

async function executeStatusUpdate(userId, newStatus, expiry) {
    try {
        const response = await fetch('/api/admin/update-user', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ targetUserId: userId, newStatus, expiryDate: expiry, userStatus: currentUser.status })
        });
        if (response.ok) { closeCustomModal(); showAlert('성공', '변경 사항이 저장되었습니다.'); refreshAdminDashboard(); }
    } catch (e) { showAlert('오류', '통신 실패'); }
}

window.setExpiryDate = function (userId) {
    currentTargetUserId = userId;
    const modal     = document.getElementById('custom-modal');
    const dateInput = document.getElementById('modal-date-input');
    document.getElementById('modal-title').innerText = '만료일 수정';
    document.getElementById('modal-desc').innerText  = '새로운 만료일을 선택하세요.';
    dateInput.style.display = 'block';
    document.getElementById('modal-cancel-btn').style.display = 'inline-block';
    document.getElementById('modal-confirm-btn').onclick = async () => {
        if (!dateInput.value) return;
        const response = await fetch('/api/admin/update-user', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ targetUserId: userId, expiryDate: dateInput.value, userStatus: currentUser.status })
        });
        if (response.ok) { closeCustomModal(); showAlert('성공', '날짜가 업데이트되었습니다.'); refreshAdminDashboard(); }
    };
    modal.style.display = 'flex';
};

window.deleteUser = function (userId, email) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').innerText = '회원 삭제';
    document.getElementById('modal-desc').innerText  = `[경고] ${email} 사용자를 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
    document.getElementById('modal-date-input').style.display = 'none';
    document.getElementById('modal-cancel-btn').style.display = 'inline-block';
    document.getElementById('modal-confirm-btn').onclick = async () => {
        const response = await fetch('/api/admin/delete-user', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ targetUserId: userId, userStatus: currentUser.status })
        });
        if (response.ok) { closeCustomModal(); showAlert('성공', '삭제되었습니다.'); refreshAdminDashboard(); }
    };
    modal.style.display = 'flex';
};

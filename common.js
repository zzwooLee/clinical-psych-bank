/* common.js */
// ─────────────────────────────────────────────────────────────────
// 수정 이력
// [FIX-Critical-1] checkAnswer — `correct` 변수로 선언 후 `safeCorrect`로
//                  참조하던 버그 수정. parseInt()로 정수 변환 후 변수명 통일.
//                  이 버그로 인해 답 선택 시 ReferenceError 발생 →
//                  정답 확인 및 해설이 전혀 표시되지 않던 문제 해결.
// [FIX-High-1]    handleLogout — 로그아웃 시 btn-admin-menu 명시적 숨김 처리
//                  index.html에서 로그인→로그아웃→재로그인 시 admin 버튼이
//                  이전 display:inline-block 상태를 유지하는 문제 수정
// [FIX-High-2]    forceLogout (자동 로그아웃) — 동일하게 btn-admin-menu 숨김 처리
// [FIX-Medium-1]  updateUserUI — catch 블록 이후 코드가 같은 줄에 붙어있던
//                  가독성 문제 해소 (동작 무해, 유지보수성 개선)
// [FIX-Medium-2]  deleteUser — 삭제 실패 시 else 분기 에러 메시지 표시 추가
// [FIX-Medium-3]  setExpiryDate — 만료일 수정 실패 시 else 분기 에러 메시지 추가
// [FIX-Low-1]     currentUser / currentTargetUserId 선언 — 한 줄에 합쳐있던 것을
//                  별도 줄로 분리하여 가독성 개선
// [기존 유지]     STORAGE_KEY 전역 상수화, setupAutoLogout 모듈,
//                 escapeHtml, authHeaders, 퀴즈 엔진, 관리자 기능 전체
// ─────────────────────────────────────────────────────────────────

const QUIZ_STORAGE_KEY = 'quiz_last_active';
window._quizStorageKey = QUIZ_STORAGE_KEY;

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
    const THROTTLE_MS =      30 * 1000;
    const STORAGE_KEY = QUIZ_STORAGE_KEY;

    let warnInterval  = null;
    let checkInterval = null;
    let throttleTimer = null;

    /* ── 마지막 활동 시각 갱신 ── */
    function resetActivity() {
        sessionStorage.setItem(STORAGE_KEY, Date.now());
        const warnModal = document.getElementById('auto-logout-modal');
        if (warnModal && warnModal.style.display === 'flex') {
            warnModal.style.display = 'none';
            clearInterval(warnInterval);
            warnInterval = null;
            startCheck();
        }
    }

    /* ── 강제 로그아웃 ── */
    function forceLogout() {
        clearInterval(warnInterval);
        clearInterval(checkInterval);
        clearTimeout(throttleTimer);
        throttleTimer = null;
        warnInterval  = null;
        checkInterval = null;

        sessionStorage.removeItem('quiz_user');
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem('quiz_token');

        const warnModal = document.getElementById('auto-logout-modal');
        if (warnModal) warnModal.style.display = 'none';

        // [FIX-High-2] 자동 로그아웃 시에도 admin 버튼 숨김 처리
        const adminBtn = document.getElementById('btn-admin-menu');
        if (adminBtn) adminBtn.style.display = 'none';

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

    /* ── 경고 모달 표시 + 카운트다운 ── */
    function showWarnModal(remainSec) {
        clearInterval(warnInterval);
        warnInterval = null;

        const modal   = document.getElementById('auto-logout-modal');
        const countEl = document.getElementById('auto-logout-count');
        if (!modal) { forceLogout(); return; }
        if (countEl) countEl.innerText = remainSec;
        modal.style.display = 'flex';

        let remain = remainSec;
        warnInterval = setInterval(() => {
            remain -= 1;
            if (countEl) countEl.innerText = remain;
            if (remain <= 0) { clearInterval(warnInterval); warnInterval = null; forceLogout(); }
        }, 1000);
    }

    /* ── 주기적 비활동 체크 시작 ── */
    function startCheck() {
        clearInterval(checkInterval);
        checkInterval = setInterval(() => {
            if (!sessionStorage.getItem('quiz_user')) { clearInterval(checkInterval); checkInterval = null; return; }
            const lastActive = parseInt(sessionStorage.getItem(STORAGE_KEY) || Date.now());
            const idle       = Date.now() - lastActive;
            const remain     = TIMEOUT_MS - idle;

            if (remain <= 0) {
                clearInterval(checkInterval);
                checkInterval = null;
                forceLogout();
            } else if (remain <= WARN_MS) {
                const modal = document.getElementById('auto-logout-modal');
                if (modal && modal.style.display !== 'flex') {
                    clearInterval(checkInterval);
                    checkInterval = null;
                    showWarnModal(Math.floor(remain / 1000));
                }
            }
        }, CHECK_MS);
    }

    window._startAutoLogoutCheck = startCheck;

    /* ── 유저 활동 이벤트 감지 ── */
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (!sessionStorage.getItem('quiz_user')) return;

            const warnModal = document.getElementById('auto-logout-modal');
            if (warnModal && warnModal.style.display === 'flex') {
                resetActivity();
                return;
            }

            if (throttleTimer) return;
            resetActivity();
            throttleTimer = setTimeout(() => { throttleTimer = null; }, THROTTLE_MS);
        }, { passive: true });
    });

    /* ── 탭 복귀 시 즉시 체크 ── */
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!sessionStorage.getItem('quiz_user')) return;
        const lastActive = parseInt(sessionStorage.getItem(STORAGE_KEY) || Date.now());
        if (Date.now() - lastActive >= TIMEOUT_MS) { forceLogout(); }
    });

    window._initAutoLogout = function () {
        if (!sessionStorage.getItem('quiz_user')) return;
        resetActivity();
        startCheck();
    };

    window.extendSession = function () {
        clearInterval(warnInterval);
        warnInterval = null;
        resetActivity();
    };
})();

// ─────────────────────────────────────────────
// 1. 전역 상태 관리
// ─────────────────────────────────────────────
let allQuestions = [];
let currentIndex = 0;

function safeParseUser() {
    try { return JSON.parse(sessionStorage.getItem('quiz_user')); }
    catch { sessionStorage.removeItem('quiz_user'); return null; }
}

// [FIX-Low-1] 두 변수 선언을 별도 줄로 분리 (가독성 개선)
let currentUser         = safeParseUser() || { email: '', status: 'free' };
let currentTargetUserId = null;

// ─────────────────────────────────────────────────────────────────
// XSS 방어 헬퍼
// DB에서 온 모든 문자열을 innerHTML에 삽입하기 전에 반드시 통과시킵니다.
// explanation처럼 관리자가 HTML을 의도적으로 사용하는 필드는
// DOMPurify 등 별도 sanitizer를 적용하는 것을 권장합니다.
// ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────
// 공통 인증 헤더 생성 헬퍼
// 모든 API 호출에 Authorization: Bearer <token> 헤더를 주입합니다.
// ─────────────────────────────────────────────────────────────────
function authHeaders() {
    const token = sessionStorage.getItem('quiz_token');
    return {
        'Content-Type' : 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
}

// ─────────────────────────────────────────────
// 2. 초기 로드 및 UI 업데이트
// ─────────────────────────────────────────────
// 단일 DOMContentLoaded로 통합:
//   1) updateUserUI()    — currentUser 파싱 및 UI 반영
//   2) _initAutoLogout() — 세션 활동 초기화 및 타이머 시작
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateUserUI();

    if (currentUser.status === 'admin') {
        const adminBtn = document.getElementById('btn-admin-menu');
        if (adminBtn) adminBtn.style.display = 'inline-block';
    }

    const guestView = document.getElementById('guest-view');
    const userView  = document.getElementById('user-view');
    if (guestView && userView && currentUser.email) {
        guestView.style.display = 'none';
        userView.style.display  = 'block';
        const infoEl = document.getElementById('user-display-info');
        const displayName = currentUser.name || currentUser.email;
        if (infoEl) infoEl.innerText = `${displayName} (${(currentUser.status || 'free').toUpperCase()})`;
    }

    if (typeof window._initAutoLogout === 'function') {
        window._initAutoLogout();
    }
});

// [FIX-Medium-1] catch 블록 이후 코드를 별도 줄로 분리하여 가독성 개선
function updateUserUI() {
    const savedUser = sessionStorage.getItem('quiz_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
        } catch {
            sessionStorage.removeItem('quiz_user');
            return;
        }
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
// ─────────────────────────────────────────────

window.handleLogin = async function () {
    const email    = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;

    if (!email || !password) {
        return showAlert('입력 오류', '이메일과 비밀번호를 입력해주세요.');
    }

    try {
        const res  = await fetch('/api/login', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        if (data.accessToken) {
            sessionStorage.setItem('quiz_token', data.accessToken);
        }

        const userData = {
            id    : data.user.id,
            email : data.user.email,
            name  : data.user.name || data.user.user_metadata?.name || '',
            status: data.status
        };
        sessionStorage.setItem('quiz_user', JSON.stringify(userData));
        currentUser = userData;

        sessionStorage.setItem(QUIZ_STORAGE_KEY, Date.now());

        if (typeof window._startAutoLogoutCheck === 'function') {
            window._startAutoLogoutCheck();
        }

        const guestView = document.getElementById('guest-view');
        const userView  = document.getElementById('user-view');
        if (guestView && userView) {
            guestView.style.display = 'none';
            userView.style.display  = 'block';
            const infoEl = document.getElementById('user-display-info');
            const loginDisplayName = data.user.name || data.user.user_metadata?.name || data.user.email;
            if (infoEl) infoEl.innerText = `${loginDisplayName} (${data.status.toUpperCase()})`;

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

    if (!name) return showAlert('입력 오류', '이름을 입력해주세요.');
    if (name.length > 20) return showAlert('입력 오류', '이름은 20자 이내로 입력해주세요.');
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

// 비밀번호 재설정 이메일 발송
window.handleResetPassword = async function () {
    const email = document.getElementById('reset-email')?.value.trim();
    if (!email) return showAlert('입력 오류', '이메일을 입력해주세요.');

    const btn = document.getElementById('btn-send-reset');
    if (btn) { btn.disabled = true; btn.innerText = '발송 중...'; }

    try {
        const res  = await fetch('/api/reset-password', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ email })
        });
        const data = await res.json();
        showAlert('이메일 발송', data.message || '재설정 링크를 발송했습니다. 스팸함도 확인해주세요.');
    } catch (e) {
        showAlert('오류', '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = '재설정 링크 발송'; }
    }
};

// 새 비밀번호 저장
window.handleSetNewPassword = async function () {
    const pw  = document.getElementById('new-password')?.value;
    const pw2 = document.getElementById('new-password-confirm')?.value;

    if (!pw || pw.length < 6) {
        return showAlert('입력 오류', '비밀번호는 6자 이상 입력해주세요.');
    }
    if (pw !== pw2) {
        return showAlert('입력 오류', '두 비밀번호가 일치하지 않습니다.');
    }

    // Supabase Legacy 플로우는 토큰을 hash fragment(#access_token=...)로 전달합니다.
    // URLSearchParams는 '#' 이후를 무시하므로 hash를 별도로 파싱합니다.
    const searchParams = new URLSearchParams(location.search);
    const hashParams   = new URLSearchParams(location.hash.replace(/^#/, ''));

    const recoveryToken = searchParams.get('token_hash')
        || hashParams.get('token_hash')
        || hashParams.get('access_token')
        || searchParams.get('access_token');

    if (!recoveryToken) {
        return showAlert('오류', '유효하지 않은 접근입니다. 재설정 이메일의 링크를 다시 클릭해주세요.');
    }

    const btn = document.getElementById('btn-set-password');
    if (btn) { btn.disabled = true; btn.innerText = '변경 중...'; }

    try {
        const res  = await fetch('/api/set-new-password', {
            method : 'POST',
            headers: {
                'Content-Type' : 'application/json',
                'Authorization': `Bearer ${recoveryToken}`
            },
            body: JSON.stringify({ password: pw })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        history.replaceState(null, '', location.pathname);
        showAlert('변경 완료', '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.');
        if (typeof switchTab === 'function') switchTab('login');
    } catch (e) {
        showAlert('오류', e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = '비밀번호 변경 완료'; }
    }
};

// ─────────────────────────────────────────────────────────────────
// 로그아웃
// ─────────────────────────────────────────────────────────────────
window.handleLogout = function () {
    const modal = document.getElementById('custom-modal');

    // [FIX-High-1] 로그아웃 실행 공통 헬퍼
    // index.html에서 로그인→로그아웃→재로그인 시 btn-admin-menu가
    // display:inline-block 상태를 유지하는 문제를 방지합니다.
    function _doLogout() {
        sessionStorage.removeItem('quiz_user');
        sessionStorage.removeItem(QUIZ_STORAGE_KEY);
        sessionStorage.removeItem('quiz_token');

        // admin 버튼 숨김 — 재로그인 후 상태 초기화 보장
        const adminBtn = document.getElementById('btn-admin-menu');
        if (adminBtn) adminBtn.style.display = 'none';

        location.href = 'index.html';
    }

    if (!modal) {
        if (confirm('정말 로그아웃 하시겠습니까?')) {
            _doLogout();
        }
        return;
    }

    document.getElementById('modal-title').innerText = '로그아웃';
    document.getElementById('modal-desc').innerText  = '정말 로그아웃 하시겠습니까?';
    document.getElementById('modal-date-input').style.display = 'none';
    document.getElementById('modal-cancel-btn').style.display = 'inline-block';

    document.getElementById('modal-confirm-btn').onclick = () => {
        _doLogout();
    };
    modal.style.display = 'flex';
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
        grade   : document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        year    : document.getElementById('sel-year')?.value,
        limit   : parseInt(document.getElementById('sel-limit')?.value || 20)
    };

    try {
        const response = await fetch('/api/questions', {
            method : 'POST',
            headers: authHeaders(),
            body   : JSON.stringify(payload)
        });

        if (response.status === 401) {
            showAlert('세션 만료', '다시 로그인해주세요.');
            location.href = 'index.html';
            return;
        }

        allQuestions = await response.json();
        currentIndex = 0;
        renderQuestion();
    } catch (e) {
        if (area) area.innerHTML = '<div style="text-align:center; padding:50px;">불러오기 실패</div>';
    }
};

function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area) return;
    if (!allQuestions.length) {
        area.innerHTML = '<div class="card" style="text-align:center; padding:50px;">해당 조건의 문제가 없습니다.</div>';
        return;
    }

    currentIndex = Math.max(0, Math.min(currentIndex, allQuestions.length - 1));

    const q           = allQuestions[currentIndex];
    const displayYear = q.exam_date ? String(q.exam_date).substring(0, 4) + '년' : '';

    const safeQuestion = escapeHtml(q.question);
    const safeCategory = escapeHtml(q.category);

    area.innerHTML = `
        <div class="card">
            <div class="card-header-info">
                <span>문제 ${currentIndex + 1} / ${allQuestions.length}</span>
                <span>${safeCategory} ${displayYear ? '(' + displayYear + ')' : ''}</span>
            </div>
            <div class="card-question">${safeQuestion}</div>
            <div class="choices">
                ${[1, 2, 3, 4].map(num => `
                    <button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})">
                        <span class="choice-num">${num}</span>
                        <span class="choice-text">${escapeHtml(q['choice' + num])}</span>
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

// [FIX-Critical-1] `correct` 변수로 선언 후 `safeCorrect`로 참조하던 버그 수정.
// 변수명을 `safeCorrect`로 통일하고, parseInt()로 정수 변환하여
// DB 값이 문자열("2")로 오더라도 [1,2,3,4].includes() 검증이 올바르게 동작하도록 수정.
window.checkAnswer = function (selected) {
    const q           = allQuestions[currentIndex];
    const safeCorrect = parseInt(q.answer, 10); // ← 핵심 수정: 변수명 통일 + 정수 변환
    const resultBox   = document.getElementById('result-box');
    const btns        = document.querySelectorAll('.choice-btn');

    btns.forEach(btn => (btn.style.pointerEvents = 'none'));

    if (![1, 2, 3, 4].includes(safeCorrect)) {
        resultBox.innerHTML     = '<div style="color:#e74c3c;">문제 데이터 오류입니다.</div>';
        resultBox.style.display = 'block';
        return;
    }

    let resultHTML = '';
    if (selected === safeCorrect) {
        document.getElementById(`choice-${selected}`).style.borderColor     = '#2ecc71';
        document.getElementById(`choice-${selected}`).style.backgroundColor = '#eafaf2';
        resultHTML = `<div style="color:#2ecc71; font-weight:800; font-size:1.2rem; margin-bottom:10px;">✅ 정답입니다!</div>`;
    } else {
        document.getElementById(`choice-${selected}`).style.borderColor     = '#e74c3c';
        document.getElementById(`choice-${selected}`).style.backgroundColor = '#fdf0ee';
        document.getElementById(`choice-${safeCorrect}`).style.borderColor      = '#2ecc71';
        document.getElementById(`choice-${safeCorrect}`).style.backgroundColor  = '#f0fff4';
        resultHTML = `<div style="color:#e74c3c; font-weight:800; font-size:1.2rem; margin-bottom:10px;">❌ 오답입니다.</div>
                      <div style="background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:15px;">정답은 <strong>${safeCorrect}번</strong> 입니다.</div>`;
    }

    if (q.explanation) {
        const isBroken = q.explanation.includes('자료 외 정보');
        const safeExp  = isBroken
            ? '해설에 문제가 있어 수정 중입니다.'
            : escapeHtml(q.explanation).replace(/\n/g, '<br>');
        resultHTML += `
            <div style="text-align:left; background:#f0f4ff; border-left:4px solid #364d79; padding:15px; border-radius:8px; margin-top:15px;">
                <strong>💡 해설:</strong><br>${safeExp}
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
// 6. 관리자 기능
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
            headers: authHeaders(),
            body   : JSON.stringify({})
        });
        if (response.status === 401 || response.status === 403) {
            console.error('관리자 권한 없음');
            return;
        }
        const stats = await response.json();
        document.getElementById('stat-total-questions').innerText = (stats.totalQuestions || 0).toLocaleString();
        document.getElementById('stat-today-users').innerText     = (stats.activeUsers || 0).toLocaleString();
        document.getElementById('stat-premium-rate').innerText    = (stats.premiumRate || 0) + '%';

        const vRes = await fetch('/api/admin/verify-stats', {
            method : 'POST',
            headers: authHeaders(),
            body   : JSON.stringify({})
        });
        if (vRes.ok) {
            const vStats   = await vRes.json();
            const verifyEl = document.getElementById('stat-verify-status');
            if (verifyEl) {
                verifyEl.innerText =
                    `검수 완료 ${(vStats.verified || 0).toLocaleString()}문제 / 미완료 ${(vStats.unverified || 0).toLocaleString()}문제`;
            }
        }
    } catch (e) { console.error('통계 실패', e); }
}

async function loadUserList() {
    try {
        const response = await fetch('/api/admin/users', {
            method : 'POST',
            headers: authHeaders(),
            body   : JSON.stringify({})
        });
        if (response.status === 401 || response.status === 403) {
            console.error('관리자 권한 없음');
            return;
        }
        const users = await response.json();
        const tbody = document.getElementById('user-list-body');
        if (!tbody) return;

        // tbody 전체를 DOM API로 구성 — innerHTML 삽입 없이 XSS 완전 차단
        tbody.innerHTML = '';

        users.forEach(user => {
            const uStatus       = user.user_status || 'free';
            const expiryDisplay = user.expiry_date ? user.expiry_date.split('T')[0] : '-';

            const tr = document.createElement('tr');

            const tdName = document.createElement('td');
            tdName.style.cssText = 'text-align:left; padding-left:15px;';
            tdName.textContent = user.name || '-';
            tr.appendChild(tdName);

            const tdEmail = document.createElement('td');
            tdEmail.style.cssText = 'text-align:left; padding-left:10px;';
            tdEmail.textContent = user.email;
            tr.appendChild(tdEmail);

            const tdStatus = document.createElement('td');
            tdStatus.style.textAlign = 'center';
            const badge = document.createElement('span');
            badge.className = `badge-${uStatus}`;
            badge.textContent = uStatus.toUpperCase();
            tdStatus.appendChild(badge);
            tr.appendChild(tdStatus);

            const tdExpiry = document.createElement('td');
            tdExpiry.style.textAlign = 'center';
            tdExpiry.textContent = expiryDisplay;
            tr.appendChild(tdExpiry);

            const tdAction = document.createElement('td');
            tdAction.style.textAlign = 'center';

            const sel = document.createElement('select');
            sel.style.cssText = 'padding:4px; border-radius:4px;';
            [['free','FREE'], ['premium','PREMIUM'], ['admin','ADMIN']].forEach(([val, label]) => {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = label;
                if (uStatus === val) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () => updateUserStatus(user.id, sel.value));
            tdAction.appendChild(sel);

            const btnCal = document.createElement('button');
            btnCal.textContent = '📅';
            btnCal.style.cssText = 'background:none; border:none; cursor:pointer;';
            btnCal.addEventListener('click', () => setExpiryDate(user.id));
            tdAction.appendChild(btnCal);

            const btnDel = document.createElement('button');
            btnDel.textContent = '🗑️';
            btnDel.style.cssText = 'background:none; border:none; cursor:pointer; color:#e74c3c; margin-left:5px;';
            btnDel.addEventListener('click', () => deleteUser(user.id, user.email));
            tdAction.appendChild(btnDel);

            tr.appendChild(tdAction);
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
// 7. 등급 / 기한 / 삭제
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

        confirmBtn.onclick = () => {
            if (!dateInput.value) return;
            executeStatusUpdate(userId, newStatus, dateInput.value);
        };
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
            headers: authHeaders(),
            body   : JSON.stringify({
                targetUserId: userId,
                newStatus,
                expiryDate  : expiry
            })
        });
        if (response.ok) {
            closeCustomModal();
            showAlert('성공', '변경 사항이 저장되었습니다.');
            refreshAdminDashboard();
        } else {
            const err = await response.json();
            showAlert('오류', err.message || '변경 실패');
        }
    } catch (e) { showAlert('오류', '통신 실패'); }
}

// [FIX-Medium-3] 만료일 수정 실패 시 else 분기 에러 메시지 추가
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
        try {
            const response = await fetch('/api/admin/update-user', {
                method : 'POST',
                headers: authHeaders(),
                body   : JSON.stringify({
                    targetUserId: userId,
                    expiryDate  : dateInput.value
                })
            });
            if (response.ok) {
                closeCustomModal();
                showAlert('성공', '날짜가 업데이트되었습니다.');
                refreshAdminDashboard();
            } else {
                const err = await response.json();
                showAlert('오류', err.message || '날짜 업데이트 실패');
            }
        } catch (e) { showAlert('오류', '통신 실패'); }
    };
    modal.style.display = 'flex';
};

// [FIX-Medium-2] 삭제 실패 시 else 분기 에러 메시지 표시 추가
window.deleteUser = function (userId, email) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').innerText = '회원 삭제';
    document.getElementById('modal-desc').innerText  = `[경고] ${email} 사용자를 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
    document.getElementById('modal-date-input').style.display = 'none';
    document.getElementById('modal-cancel-btn').style.display = 'inline-block';

    document.getElementById('modal-confirm-btn').onclick = async () => {
        try {
            const response = await fetch('/api/admin/delete-user', {
                method : 'POST',
                headers: authHeaders(),
                body   : JSON.stringify({ targetUserId: userId })
            });
            if (response.ok) {
                closeCustomModal();
                showAlert('성공', '삭제되었습니다.');
                refreshAdminDashboard();
            } else {
                const err = await response.json();
                showAlert('오류', err.message || '삭제 실패');
            }
        } catch (e) { showAlert('오류', '통신 실패'); }
    };
    modal.style.display = 'flex';
};

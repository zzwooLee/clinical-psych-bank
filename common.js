/* common.js */

// ─────────────────────────────────────────────
// 0. 자동 로그아웃 모듈
//    · 비활동 30분 경과 시 자동 로그아웃
//    · 만료 2분 전 경고 모달 → "계속하기" 누르면 세션 연장
//    · 탭 전환 후 복귀 시에도 즉시 체크
// ─────────────────────────────────────────────
(function setupAutoLogout() {
    const TIMEOUT_MS  = 30 * 60 * 1000;  // 비활동 허용 시간 : 30분
    const WARN_MS     =  2 * 60 * 1000;  // 만료 몇 ms 전에 경고 : 2분
    const CHECK_MS    =      60 * 1000;  // 주기적 체크 간격   : 1분
    const STORAGE_KEY = 'quiz_last_active';

    let warnInterval  = null;   // 경고 모달 카운트다운 타이머
    let checkInterval = null;   // 주기 체크 타이머
    let throttleTimer = null;   // 활동 감지 스로틀 타이머

    /* ── 마지막 활동 시각 갱신 ── */
    function resetActivity() {
        sessionStorage.setItem(STORAGE_KEY, Date.now());
        // 경고 모달이 열려 있으면 닫기
        const warnModal = document.getElementById('auto-logout-modal');
        if (warnModal && warnModal.style.display === 'flex') {
            warnModal.style.display = 'none';
            clearInterval(warnInterval);
        }
    }

    /* ── 강제 로그아웃 ── */
    function forceLogout() {
        clearInterval(warnInterval);
        clearInterval(checkInterval);
        sessionStorage.removeItem('quiz_user');
        sessionStorage.removeItem(STORAGE_KEY);
        const warnModal = document.getElementById('auto-logout-modal');
        if (warnModal) warnModal.style.display = 'none';
        // index.html 자체에서는 리다이렉트 생략
        const path = location.pathname;
        if (!path.endsWith('index.html') && path !== '/' && path !== '') {
            location.href = 'index.html';
        } else {
            // index 페이지면 UI만 초기화
            const guestView = document.getElementById('guest-view');
            const userView  = document.getElementById('user-view');
            if (guestView) guestView.style.display = 'block';
            if (userView)  userView.style.display  = 'none';
        }
    }

    /* ── 경고 모달 표시 + 카운트다운 ── */
    function showWarnModal(remainSec) {
        const modal   = document.getElementById('auto-logout-modal');
        const countEl = document.getElementById('auto-logout-count');
        if (!modal) {
            // 모달 DOM이 없는 페이지는 바로 로그아웃
            forceLogout();
            return;
        }
        if (countEl) countEl.innerText = remainSec;
        modal.style.display = 'flex';

        let remain = remainSec;
        warnInterval = setInterval(() => {
            remain -= 1;
            if (countEl) countEl.innerText = remain;
            if (remain <= 0) {
                clearInterval(warnInterval);
                forceLogout();
            }
        }, 1000);
    }

    /* ── 주기적 비활동 체크 시작 ── */
    function startCheck() {
        clearInterval(checkInterval);   // 중복 방지
        checkInterval = setInterval(() => {
            if (!sessionStorage.getItem('quiz_user')) {
                clearInterval(checkInterval);
                return;
            }
            const lastActive = parseInt(sessionStorage.getItem(STORAGE_KEY) || Date.now());
            const idle       = Date.now() - lastActive;
            const remain     = TIMEOUT_MS - idle;

            if (remain <= 0) {
                clearInterval(checkInterval);
                forceLogout();
            } else if (remain <= WARN_MS) {
                const modal = document.getElementById('auto-logout-modal');
                if (modal && modal.style.display !== 'flex') {
                    clearInterval(checkInterval);   // 경고 중엔 체크 일시 중단
                    showWarnModal(Math.floor(remain / 1000));
                }
            }
        }, CHECK_MS);
    }

    /* ── 유저 활동 이벤트 감지 (30초 스로틀) ── */
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(evt => {
        document.addEventListener(evt, () => {
            if (!sessionStorage.getItem('quiz_user')) return;
            if (throttleTimer) return;
            throttleTimer = setTimeout(() => {
                resetActivity();
                throttleTimer = null;
            }, 30 * 1000);
        }, { passive: true });
    });

    /* ── 탭 복귀 시 즉시 체크 ── */
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (!sessionStorage.getItem('quiz_user')) return;
        const lastActive = parseInt(sessionStorage.getItem(STORAGE_KEY) || Date.now());
        if (Date.now() - lastActive >= TIMEOUT_MS) {
            forceLogout();
        }
    });

    /* ── 페이지 로드 후 초기화 ── */
    document.addEventListener('DOMContentLoaded', () => {
        if (!sessionStorage.getItem('quiz_user')) return;
        resetActivity();
        startCheck();
    });

    /* ── 외부에서 호출: "계속하기" 버튼 ── */
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
// [#3] sessionStorage에 저장 시 status 필드로 통일했으므로 user_status 폴백 제거
let currentUser = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };
let currentTargetUserId = null;

// ─────────────────────────────────────────────
// 2. 초기 로드 및 UI 업데이트
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateUserUI();

    // [#3] currentUser.status 단일 필드 사용
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
});

function updateUserUI() {
    const savedUser = sessionStorage.getItem('quiz_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        const nameEl   = document.getElementById('display-name');
        const statusEl = document.getElementById('display-status');

        if (nameEl)   nameEl.innerText   = currentUser.name || currentUser.email;
        // [#3] status 단일 필드 사용
        if (statusEl) statusEl.innerText = (currentUser.status || 'free').toUpperCase();
    }
}

// ─────────────────────────────────────────────
// 3. 커스텀 모달 제어 (주소창 노출 방지)
// ─────────────────────────────────────────────
window.closeCustomModal = function () {
    const modal = document.getElementById('custom-modal');
    if (modal) modal.style.display = 'none';
};

window.showAlert = function (title, desc) {
    const modal = document.getElementById('custom-modal');
    // 모달 DOM이 없는 페이지(index.html 등) 대비 안전망
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
// 4. 인증 — 로그인 / 회원가입 / 로그아웃 / 비밀번호 재설정
// ─────────────────────────────────────────────

// [#1 추가] 로그인 핸들러 — index.html의 onclick="handleLogin()" 연결
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

        // [#3] 세션 저장 시 status 필드명으로 통일
        const userData = {
            id    : data.user.id,
            email : data.user.email,
            name  : data.user.name || '',   // 이름 저장
            status: data.status             // 'free' | 'premium' | 'admin'
        };
        sessionStorage.setItem('quiz_user', JSON.stringify(userData));
        currentUser = userData;

        // 로그인 성공 시 활동 시각 초기화 + 체크 시작
        sessionStorage.setItem('quiz_last_active', Date.now());

        // index.html 전용: guest-view → user-view 전환
        const guestView = document.getElementById('guest-view');
        const userView  = document.getElementById('user-view');
        if (guestView && userView) {
            guestView.style.display = 'none';
            userView.style.display  = 'block';
            const infoEl = document.getElementById('user-display-info');
            const loginDisplayName = data.user.name || data.user.email;
            if (infoEl) infoEl.innerText = `${loginDisplayName} (${data.status.toUpperCase()})`;

            // admin이면 버튼 표시
            if (data.status === 'admin') {
                const adminBtn = document.getElementById('btn-admin-menu');
                if (adminBtn) adminBtn.style.display = 'inline-block';
            }
        } else {
            // premium.html 등 다른 페이지에서 호출된 경우
            location.href = 'premium.html';
        }
    } catch (e) {
        showAlert('로그인 실패', e.message);
    }
};

// [#1 추가] 회원가입 핸들러 — index.html의 onclick="handleSignUp()" 연결
window.handleSignUp = async function () {
    const name     = document.getElementById('signup-name')?.value.trim();
    const email    = document.getElementById('signup-email')?.value.trim();
    const password = document.getElementById('signup-password')?.value;

    if (!name) {
        return showAlert('입력 오류', '이름을 입력해주세요.');
    }
    if (name.length > 20) {
        return showAlert('입력 오류', '이름은 20자 이내로 입력해주세요.');
    }
    if (!email || !password) {
        return showAlert('입력 오류', '이메일과 비밀번호를 입력해주세요.');
    }
    if (password.length < 6) {
        return showAlert('입력 오류', '비밀번호는 6자 이상이어야 합니다.');
    }

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

// 로그아웃 — 원본 로직 유지, 모달 없는 페이지 안전망 추가
window.handleLogout = function () {
    const modal = document.getElementById('custom-modal');

    // 모달이 없는 페이지(index.html)는 바로 처리
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

// ★ [추가] 비밀번호 재설정 핸들러
// Supabase Auth REST API(/auth/v1/recover)를 직접 호출 — 별도 서버 파일 불필요
// SUPABASE_URL / SUPABASE_ANON_KEY 는 클라이언트 노출이 허용된 공개 값입니다.
// (민감한 Service Role Key와 다릅니다 — Vercel 환경변수 SUPABASE_KEY와 혼동 주의)
window.handleResetPassword = async function () {
    const email = document.getElementById('reset-email')?.value.trim();

    if (!email) {
        return showAlert('입력 오류', '이메일을 입력해주세요.');
    }
    // 간단한 이메일 형식 검사
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showAlert('입력 오류', '올바른 이메일 형식을 입력해주세요.');
    }

    // ★ 아래 두 값을 본인 Supabase 프로젝트 값으로 교체하세요.
    // Supabase 대시보드 → Project Settings → API 에서 확인
    const SUPABASE_URL      = 'https://YOUR_PROJECT_ID.supabase.co';  // ← 교체 필요
    const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';                         // ← 교체 필요

    // 재설정 완료 후 리다이렉트될 URL (Supabase 대시보드 URL Configuration과 일치해야 함)
    const REDIRECT_URL = `${location.origin}/index.html`;

    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
            method : 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey'      : SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                email,
                gotrue_meta_security: {},
                redirect_to: REDIRECT_URL
            })
        });

        // Supabase는 보안 정책상 이메일 존재 여부와 무관하게 항상 200을 반환합니다.
        // (계정 존재 여부 노출 방지)
        if (res.ok || res.status === 200) {
            showAlert(
                '📧 메일 발송 완료',
                `${email} 로 재설정 링크를 발송했습니다.\n\n` +
                '이메일함(스팸함 포함)을 확인해주세요.\n' +
                '링크는 1시간 후 만료됩니다.'
            );
            // 모달 확인 후 로그인 탭으로 이동
            const confirmBtn = document.getElementById('modal-confirm-btn');
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    closeCustomModal();
                    if (typeof switchTab === 'function') switchTab('login');
                };
            }
        } else {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.msg || errData.message || '요청 실패');
        }
    } catch (e) {
        showAlert('오류', '잠시 후 다시 시도해주세요.\n(' + e.message + ')');
    }
};

// ─────────────────────────────────────────────
// 5. 퀴즈 엔진
// ─────────────────────────────────────────────

// [#10 추가] 인증 체크 — 비로그인 상태에서 호출 방지
window.loadQuestions = async function () {
    if (!currentUser?.email) {
        showAlert('인증 필요', '로그인 후 이용해주세요.');
        return;
    }

    const area = document.getElementById('question-area');
    if (area) area.innerHTML = '<div style="text-align:center; padding:50px;">데이터 로드 중...</div>';

    // [#3] userStatus 단일 필드 사용
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
                ${[1, 2, 3, 4].map(num => `
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
    const btns      = document.querySelectorAll('.choice-btn');

    btns.forEach(btn => (btn.style.pointerEvents = 'none'));

    let resultHTML = '';
    if (selected == correct) {
        document.getElementById(`choice-${selected}`).style.borderColor     = '#2ecc71';
        document.getElementById(`choice-${selected}`).style.backgroundColor = '#eafaf2';
        resultHTML = `<div style="color:#2ecc71; font-weight:800; font-size:1.2rem; margin-bottom:10px;">✅ 정답입니다!</div>`;
    } else {
        document.getElementById(`choice-${selected}`).style.borderColor     = '#e74c3c';
        document.getElementById(`choice-${selected}`).style.backgroundColor = '#fdf0ee';
        document.getElementById(`choice-${correct}`).style.borderColor      = '#2ecc71';
        document.getElementById(`choice-${correct}`).style.backgroundColor  = '#f0fff4';
        resultHTML = `<div style="color:#e74c3c; font-weight:800; font-size:1.2rem; margin-bottom:10px;">❌ 오답입니다.</div>
                      <div style="background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:15px;">정답은 <strong>${correct}번</strong> 입니다.</div>`;
    }

    if (q.explanation) {
        resultHTML += `
            <div style="text-align:left; background:#f0f4ff; border-left:4px solid #364d79; padding:15px; border-radius:8px; margin-top:15px;">
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
    // [#3] status 단일 필드
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
    // [#3] status 단일 필드
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
                        <option value="free"    ${uStatus === 'free'    ? 'selected' : ''}>FREE</option>
                        <option value="premium" ${uStatus === 'premium' ? 'selected' : ''}>PREMIUM</option>
                        <option value="admin"   ${uStatus === 'admin'   ? 'selected' : ''}>ADMIN</option>
                    </select>
                    <button onclick="setExpiryDate('${user.id}')" style="background:none; border:none; cursor:pointer;">📅</button>
                    <button onclick="deleteUser('${user.id}', '${user.email}')" style="background:none; border:none; cursor:pointer; color:#e74c3c; margin-left:5px;">🗑️</button>
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
    // [#3] status 단일 필드
    try {
        const response = await fetch('/api/admin/update-user', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                targetUserId: userId,
                newStatus,
                expiryDate  : expiry,
                userStatus  : currentUser.status
            })
        });
        if (response.ok) {
            closeCustomModal();
            showAlert('성공', '변경 사항이 저장되었습니다.');
            refreshAdminDashboard();
        }
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
        // [#3] status 단일 필드
        const response = await fetch('/api/admin/update-user', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                targetUserId: userId,
                expiryDate  : dateInput.value,
                userStatus  : currentUser.status
            })
        });
        if (response.ok) {
            closeCustomModal();
            showAlert('성공', '날짜가 업데이트되었습니다.');
            refreshAdminDashboard();
        }
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
        // [#3] status 단일 필드
        const response = await fetch('/api/admin/delete-user', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
                targetUserId: userId,
                userStatus  : currentUser.status
            })
        });
        if (response.ok) {
            closeCustomModal();
            showAlert('성공', '삭제되었습니다.');
            refreshAdminDashboard();
        }
    };
    modal.style.display = 'flex';
};

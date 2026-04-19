/* common.js */

// 1. 전역 상태 관리
let allQuestions = [];
let currentIndex = 0;
let currentUser = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };

/**
 * 2. 회원가입 함수
 */
async function handleSignUp() {
    const email = document.getElementById('email')?.value;
    const password = document.getElementById('password')?.value;
    
    if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();
        if (response.ok) alert("가입 확인 이메일을 보냈습니다! 메일함을 확인해 주세요.");
        else alert("가입 실패: " + result.message);
    } catch (e) { alert("서버 통신 오류가 발생했습니다."); }
}

/**
 * 3. 로그인 함수
 */
async function handleLogin() {
    const email = document.getElementById('email')?.value;
    const password = document.getElementById('password')?.value;
    if (!email || !password) return alert("정보를 입력해주세요.");

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const result = await response.json();
        if (response.ok) {
            currentUser = { email: result.user.email, status: result.status };
            sessionStorage.setItem('quiz_user', JSON.stringify(currentUser));
            if (currentUser.status === 'premium' || currentUser.status === 'admin') {
                location.href = 'premium.html';
            } else {
                alert("로그인 성공!");
                updateUserUI();
            }
        } else alert(result.message);
    } catch (e) { alert("로그인 서버 오류"); }
}

/**
 * 4. 로그아웃 함수
 */
function handleLogout() {
    if (confirm("로그아웃 하시겠습니까?")) {
        sessionStorage.removeItem('quiz_user');
        location.href = 'index.html';
    }
}

/**
 * 5. 문제 데이터 로드
 */
async function loadQuestions() {
    const area = document.getElementById('question-area');
    if (area) area.innerHTML = '<div class="loading" style="text-align:center; padding:50px;">데이터 로드 중...</div>';

    const payload = {
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        year: document.getElementById('sel-year')?.value,
        limit: parseInt(document.getElementById('sel-limit')?.value || 20),
        userStatus: currentUser.status
    };

    try {
        const response = await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        allQuestions = await response.json();
        currentIndex = 0;
        renderQuestion();
    } catch (e) {
        if (area) area.innerHTML = '<div class="error" style="text-align:center; padding:50px;">불러오기 실패</div>';
    }
}

/**
 * 6. 문제 렌더링
 */
function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area || allQuestions.length === 0) {
        if (area) area.innerHTML = '<div class="card" style="text-align:center; padding:50px;">해당 조건의 문제가 없습니다.</div>';
        return;
    }

    const q = allQuestions[currentIndex];
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

/**
 * 7. 정답 확인 및 해설 노출 (수정된 로직)
 */
function checkAnswer(selected) {
    const q = allQuestions[currentIndex];
    const correct = q.answer;
    const resultBox = document.getElementById('result-box');
    const btns = document.querySelectorAll('.choice-btn');

    // 모든 보기 클릭 비활성화
    btns.forEach(btn => btn.style.pointerEvents = 'none');

    let resultHTML = "";

    if (selected == correct) {
        // 정답 시 시각 효과
        const selectedBtn = document.getElementById(`choice-${selected}`);
        selectedBtn.style.borderColor = "#2ecc71";
        selectedBtn.style.backgroundColor = "#eafaf2";
        selectedBtn.style.borderWidth = "2px";
        resultHTML = `<div class="result-msg success" style="color:#2ecc71; font-weight:800; font-size:1.2rem; margin-bottom:10px;">✅ 정답입니다!</div>`;
    } else {
        // 오답 시 시각 효과
        const selectedBtn = document.getElementById(`choice-${selected}`);
        const correctBtn = document.getElementById(`choice-${correct}`);
        
        selectedBtn.style.borderColor = "#e74c3c";
        selectedBtn.style.backgroundColor = "#fdf0ee";
        
        correctBtn.style.borderColor = "#2ecc71";
        correctBtn.style.backgroundColor = "#f0fff4";
        correctBtn.style.borderWidth = "2px";

        resultHTML = `
            <div class="result-msg error" style="color:#e74c3c; font-weight:800; font-size:1.2rem; margin-bottom:10px;">❌ 오답입니다.</div>
            <div class="correct-info" style="background:#f8f9fa; padding:12px; border-radius:8px; margin-bottom:15px; font-size:1rem; color:#4a5568;">
                정답은 <strong>${correct}번. ${q['choice' + correct]}</strong> 입니다.
            </div>
        `;
    }

    // 해설(explanation) 필드가 존재하고 내용이 있을 경우 해설 박스 추가
    if (q.explanation && q.explanation.trim() !== "") {
        resultHTML += `
            <div class="explanation-box" style="text-align:left; background:#f0f4ff; border-left:4px solid #364d79; padding:15px; border-radius:4px 12px 12px 4px; margin-top:15px;">
                <div class="exp-title" style="font-weight:700; color:#364d79; margin-bottom:8px; font-size:0.95rem;">💡 문제 해설</div>
                <div class="exp-content" style="font-size:0.95rem; color:#2d3748; line-height:1.6; word-break:keep-all;">${q.explanation}</div>
            </div>
        `;
    }

    resultBox.innerHTML = resultHTML;
    resultBox.style.display = 'block';
}

function changeQuestion(step) {
    currentIndex += step;
    renderQuestion();
}

/**
 * 8. UI 유틸리티
 */
function updateUserUI() {
    const savedUser = sessionStorage.getItem('quiz_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        const guestView = document.getElementById('guest-view');
        const userView = document.getElementById('user-view');
        const info = document.getElementById('user-display-info');

        if (guestView && userView) {
            guestView.style.display = 'none';
            userView.style.display = 'block';
            if (info) info.innerText = `${currentUser.email}님 (등급: ${currentUser.status.toUpperCase()})`;
        }
    }
}

/* common.js 내 관리자 대시보드 로직 */

async function loadAdminStats() {
    if (currentUser.status !== 'admin') return;

    try {
        const response = await fetch('/api/admin/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userStatus: currentUser.status })
        });
        
        const stats = await response.json();
        
        // 데이터 반영
        document.getElementById('stat-total-questions').innerText = stats.totalQuestions.toLocaleString();
        document.getElementById('stat-today-users').innerText = stats.activeUsers.toLocaleString();
        document.getElementById('stat-premium-rate').innerText = stats.premiumRate + "%";
    } catch (e) {
        console.error("통계 로드 실패", e);
    }
}

// 관리자 패널 토글 시 데이터 로드
function toggleAdminPanel() {
    const adminPanel = document.getElementById('admin-panel');
    const filterBar = document.querySelector('.filter-bar'); // 필터 영역
    const questionArea = document.getElementById('question-area'); // 문제 영역
    
    const isOpening = adminPanel.style.display === 'none';

    if (isOpening) {
        // 1. 대시보드를 열 때
        adminPanel.style.display = 'block';
        if (filterBar) filterBar.style.display = 'none';   // 필터 숨김
        if (questionArea) questionArea.style.display = 'none'; // 퀴즈 숨김
        loadAdminStats(); // 통계 데이터 로드
    } else {
        // 2. 대시보드를 닫을 때
        adminPanel.style.display = 'none';
        if (filterBar) filterBar.style.display = 'flex';    // 필터 다시 표시
        if (questionArea) questionArea.style.display = 'block'; // 퀴즈 다시 표시
    }
}

// 초기 로드 시 유저 정보 확인
document.addEventListener('DOMContentLoaded', () => {
    updateUserUI(); // 유저 정보 표시 로직 (기존 코드)

    // [추가] 관리자일 경우 버튼 노출
    if (currentUser && currentUser.status === 'admin') {
        const adminBtn = document.getElementById('btn-admin-menu');
        if (adminBtn) adminBtn.style.display = 'inline-block';
    }
});

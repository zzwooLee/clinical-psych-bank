/* common.js */

// 1. 전역 상태 및 세션 복구
let allQuestions = [];
let currentIndex = 0;
// 브라우저 저장소에서 로그인 정보 가져오기
let currentUser = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };

/**
 * 2. 회원가입 처리 (Vercel API 이용)
 */
async function handleSignUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();
        if (response.ok) {
            alert("가입 확인 이메일을 보냈습니다! 메일함을 확인해주세요.");
        } else {
            alert("가입 실패: " + result.message);
        }
    } catch (error) {
        console.error("Signup error:", error);
        alert("서버 통신 중 오류가 발생했습니다.");
    }
}

/**
 * 3. 로그인 처리 및 세션 저장
 */
async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    if (!email || !password) return alert("이메일과 비밀번호를 입력해주세요.");

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();
        if (response.ok) {
            // 사용자 정보 업데이트 및 세션 저장
            currentUser = {
                email: result.user.email,
                status: result.status
            };
            sessionStorage.setItem('quiz_user', JSON.stringify(currentUser));
            
            if (currentUser.status === 'premium' || currentUser.status === 'admin') {
                location.href = 'premium.html'; // 프리미엄 페이지 이동
            } else {
                alert("로그인 성공! 무료 등급 서비스를 이용합니다.");
                updateUserUI(); // 메인페이지 UI 갱신
            }
        } else {
            alert("로그인 실패: " + result.message);
        }
    } catch (error) {
        console.error("Login error:", error);
        alert("로그인 서버 오류가 발생했습니다.");
    }
}

/**
 * 4. 로그아웃 처리
 */
function handleLogout() {
    sessionStorage.removeItem('quiz_user');
    currentUser = { email: '', status: 'free' };
    alert("로그아웃 되었습니다.");
    location.href = 'index.html';
}

/**
 * 5. 문제 데이터 로드
 */
async function loadQuestions() {
    const area = document.getElementById('question-area');
    if(area) area.innerHTML = '<div class="loading">데이터를 불러오는 중...</div>';

    const payload = {
        grade: document.getElementById('sel-grade')?.value,
        category: document.getElementById('sel-category')?.value,
        year: document.getElementById('sel-year')?.value,
        userStatus: currentUser.status
    };

    try {
        const response = await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("로드 실패");

        allQuestions = await response.json();
        currentIndex = 0;
        renderQuestion();
    } catch (error) {
        if(area) area.innerHTML = '<div class="error">문제 로드 실패: ' + error.message + '</div>';
    }
}

/**
 * 6. 문제 카드 렌더링
 */
function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area || allQuestions.length === 0) {
        if(area) area.innerHTML = '<div class="card">해당 조건의 문제가 없습니다.</div>';
        return;
    }

    const q = allQuestions[currentIndex];
    area.innerHTML = `
        <div class="card">
            <div class="card-header-info">
                <span>문제 ${currentIndex + 1}</span>
                <span>${q.category || ''}</span>
            </div>
            <div class="card-question">
                ${q.question}
            </div>
            <div class="choices">
                ${[1, 2, 3, 4].map(num => `
                    <button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})">
                        <span class="choice-num">${num}</span>
                        <span class="choice-text">${q['choice' + num]}</span>
                    </button>
                `).join('')}
            </div>
            <div id="result-box" class="result-box" style="display:none; margin-top:20px;"></div>
            
            <div class="card-footer">
                <button class="btn-nav" onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
                <span class="page-indicator">${currentIndex + 1} / ${allQuestions.length}</span>
                <button class="btn-nav active" onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
            </div>
        </div>
    `;
}

/**
 * 7. 정답 확인 로직
 */
function checkAnswer(selected) {
    const correct = allQuestions[currentIndex].answer;
    const resultBox = document.getElementById('result-box');
    const btns = document.querySelectorAll('.choice-btn');

    btns.forEach(btn => btn.style.pointerEvents = 'none');

    if (selected == correct) {
        document.getElementById(`choice-${selected}`).style.borderColor = "#2ecc71";
        document.getElementById(`choice-${selected}`).style.backgroundColor = "#eafaf2";
        resultBox.innerHTML = "<span style='color: #2ecc71;'>✅ 정답입니다!</span>";
    } else {
        document.getElementById(`choice-${selected}`).style.borderColor = "#e74c3c";
        document.getElementById(`choice-${selected}`).style.backgroundColor = "#fdf0ee";
        document.getElementById(`choice-${correct}`).style.borderColor = "#2ecc71";
        resultBox.innerHTML = `<span style='color: #e74c3c;'>❌ 오답입니다. 정답은 ${correct}번입니다.</span>`;
    }
    resultBox.style.display = 'block';
}

function changeQuestion(step) {
    currentIndex += step;
    renderQuestion();
}

/**
 * 8. UI 연동 및 초기화 (index.html용)
 */
function updateUserUI() {
    const guestView = document.getElementById('guest-view');
    const userView = document.getElementById('user-view');
    const info = document.getElementById('user-display-info');

    if (currentUser.email) {
        if(guestView) guestView.style.display = 'none';
        if(userView) userView.style.display = 'block';
        if(info) info.innerText = `${currentUser.email}님 (등급: ${currentUser.status.toUpperCase()})`;
    }
}

// 페이지 로드 시 상태 감지
document.addEventListener('DOMContentLoaded', () => {
    // index.html 처리
    if (location.pathname.endsWith('index.html') || location.pathname === '/') {
        updateUserUI();
    }
    // premium.html 정보 자동 매핑
    const emailDisp = document.getElementById('display-email');
    const statusDisp = document.getElementById('display-status');
    if(emailDisp && currentUser.email) emailDisp.innerText = currentUser.email;
    if(statusDisp && currentUser.status) statusDisp.innerText = currentUser.status.toUpperCase();
});

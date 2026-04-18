/* common.js */

// 1. 전역 변수
let allQuestions = [];
let currentIndex = 0;
let currentUser = JSON.parse(sessionStorage.getItem('quiz_user')) || { email: '', status: 'free' };

/**
 * 2. 회원가입 함수 (ReferenceError 방지를 위해 최상단 배치)
 */
async function handleSignUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    if (!email || !password) {
        alert("이메일과 비밀번호를 입력해주세요.");
        return;
    }

    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();
        if (response.ok) {
            alert("가입 확인 이메일을 보냈습니다! 메일함을 확인해 주세요.");
        } else {
            alert("가입 실패: " + result.message);
        }
    } catch (error) {
        console.error("Signup error:", error);
        alert("서버와 통신할 수 없습니다.");
    }
}

/**
 * 3. 로그인 함수
 */
async function handleLogin(e) {
    // 1. 이벤트 전파 방지 (버튼이 form 안에 있을 경우 대비)
    if (e && e.preventDefault) e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) return alert("정보를 입력해주세요.");

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        // 응답을 받기 전에 채널이 닫히지 않도록 데이터 처리를 기다림
        const result = await response.json();

        if (response.ok) {
            currentUser = { email: result.user.email, status: result.status };
            sessionStorage.setItem('quiz_user', JSON.stringify(currentUser));
            
            // 페이지 이동 전 약간의 여유(짧은 지연)를 주어 메시지 채널 안정화
            setTimeout(() => {
                if (currentUser.status === 'premium' || currentUser.status === 'admin') {
                    location.href = 'premium.html';
                } else {
                    alert("로그인 성공!");
                    updateUserUI();
                }
            }, 100); 
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error("Login Error:", error);
        // 채널 오류가 발생하더라도 사용자에게는 명확한 메시지 전달
        if (!navigator.onLine) alert("네트워크 연결을 확인해주세요.");
    }
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

// 나머지 퀴즈 관련 함수들 (loadQuestions, renderQuestion 등 기존과 동일)
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
        if (area) area.innerHTML = '불러오기 실패';
    }
}

function renderQuestion() {
    const area = document.getElementById('question-area');
    if (!area || allQuestions.length === 0) return;
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
                ${[1, 2, 3, 4].map(num => `<button class="choice-btn" id="choice-${num}" onclick="checkAnswer(${num})"><span class="choice-num">${num}</span>${q['choice' + num]}</button>`).join('')}
            </div>
            <div id="result-box" class="result-box" style="display:none; margin-top:20px; text-align:center;"></div>
            <div class="card-footer">
                <button class="btn-nav" onclick="changeQuestion(-1)" ${currentIndex === 0 ? 'disabled' : ''}>이전</button>
                <button class="btn-nav active" onclick="changeQuestion(1)" ${currentIndex === allQuestions.length - 1 ? 'disabled' : ''}>다음</button>
            </div>
        </div>
    `;
}

function checkAnswer(selected) {
    const correct = allQuestions[currentIndex].answer;
    const resultBox = document.getElementById('result-box');
    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach(btn => btn.style.pointerEvents = 'none');
    if (selected == correct) {
        document.getElementById(`choice-${selected}`).style.backgroundColor = "#eafaf2";
        resultBox.innerHTML = "✅ 정답입니다!";
    } else {
        document.getElementById(`choice-${selected}`).style.backgroundColor = "#fdf0ee";
        resultBox.innerHTML = "❌ 오답입니다.";
    }
    resultBox.style.display = 'block';
}

function changeQuestion(step) {
    currentIndex += step;
    renderQuestion();
}

function updateUserUI() {
    const guestView = document.getElementById('guest-view');
    const userView = document.getElementById('user-view');
    const info = document.getElementById('user-display-info');
    if (currentUser.email && guestView && userView) {
        guestView.style.display = 'none';
        userView.style.display = 'block';
        if (info) info.innerText = `${currentUser.email}님 (등급: ${currentUser.status.toUpperCase()})`;
    }
}

document.addEventListener('DOMContentLoaded', updateUserUI);

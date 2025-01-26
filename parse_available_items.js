const fs = require('fs');

// JSON 파일 경로
const filePath = 'responses/response_available_items.json'; // 파일 경로 수정 필요

// JSON 파일 읽기
const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

// market: KRW-* 형태만 남기기
const filteredData = jsonData.filter(item => item.market.startsWith('KRW-'));

// 결과를 파일에 저장
fs.writeFileSync(filePath, JSON.stringify(filteredData, null, 2));

console.log('필터링 완료: KRW-* 형태만 남겼습니다.');
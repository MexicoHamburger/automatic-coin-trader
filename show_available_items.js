const request = require('request');
const fs = require('fs'); // 파일 시스템 모듈 추가

const options = {
    uri: "https://api.upbit.com/v1/market/all?is_details=true",
    method: 'GET',
    headers: {
        'Content-Type': 'application/json',
    }
};

request(options, function (error, response, body) {
    if (error) {
        console.error('Error:', error); // 요청 실패 시 에러 출력
        return;
    }
    try {
        // body를 JSON 객체로 변환
        const jsonResponse = JSON.parse(body);

        // JSON 객체를 파일로 저장
        fs.writeFileSync('responses/response_available_items.json', JSON.stringify(jsonResponse, null, 2), 'utf8');
        console.log('JSON 데이터를 response_available_items.json 파일에 저장했습니다.');
    } catch (e) {
        console.error('Error parsing JSON:', e); // JSON 파싱 실패 시 에러 출력
    }
});

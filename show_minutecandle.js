// npm install axios
const axios = require('axios');
const fs = require('fs'); // 파일 시스템 모듈

// KRW-BTC 마켓에 2024년 10월 1일(UTC) 이전 가장 최근 3분봉 5개를 요청
const url = "https://api.upbit.com/v1/candles/minutes/3";
const params = {
    market: 'KRW-BTC',
    count: 5,
    to: '2024-10-01 00:00:00'
};

axios.get(url, { params: params })
  .then(response => {
    // JSON 데이터를 파일로 저장
    const filePath = 'responses/minute_candles.json';
    const dataToSave = `${JSON.stringify(response.data, null, 2)}`;

    // 디렉토리 확인 및 생성
    const dir = 'response';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir); // response 디렉토리 생성
    }

    // 파일 저장
    fs.writeFileSync(filePath, dataToSave, 'utf8');
    console.log(`데이터가 ${filePath}에 저장되었습니다.`);
  })
  .catch(error => {
    if (error.response) {
      console.log(`Error Status Code: ${error.response.status}`);
      console.log('Error Response Data:');
      console.log(error.response.data);
    } else {
      console.log('Error:', error.message);
    }
  });

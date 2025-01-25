// npm install axios json2csv
const axios = require('axios');
const fs = require('fs');
const { parse } = require('json2csv');

// 설정
const url = "https://api.upbit.com/v1/candles/minutes/30";
const market = "KRW-BTC";
const count = 200; // API 최대 요청 데이터 수
const filePath = "responses/30min_candle_1year.csv"; // 최종 저장 파일
let toDate = new Date(); // 현재 시간부터 시작
let oneYearAgo = new Date();
oneYearAgo.setFullYear(toDate.getFullYear() - 1); // 1년 전

// CSV 파일 초기화
if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // 기존 파일 삭제
fs.writeFileSync(filePath, ''); // 빈 파일 생성

// 데이터를 가져와 CSV로 저장하는 함수
async function fetchAndSaveCandles() {
  let allData = []; // 모든 데이터를 누적 저장할 배열
  let isFinished = false; // 데이터 가져오기 종료 여부

  while (!isFinished) {
    try {
      // 요청 파라미터 설정
      const params = {
        market: market,
        count: count,
        to: toDate.toISOString().replace('T', ' ').split('.')[0], // API 요청에 맞게 형식 변환
      };

      // API 요청
      console.log(`Fetching data up to: ${params.to}`);
      const response = await axios.get(url, { params: params });

      // 데이터가 없으면 종료
      if (response.data.length === 0) {
        isFinished = true;
        break;
      }

      // 응답 데이터를 누적
      allData = allData.concat(response.data);

      // 가장 오래된 데이터의 `candle_date_time_utc`를 다음 요청의 기준으로 설정
      const oldestCandle = response.data[response.data.length - 1];
      toDate = new Date(oldestCandle.candle_date_time_utc);

      // 1년 이전 데이터까지 도달하면 종료
      if (toDate < oneYearAgo) {
        isFinished = true;
      }

      // CSV로 저장
      const opts = {
        fields: Object.keys(response.data[0]), // 데이터의 필드 자동 감지
        header: allData.length === response.data.length, // 헤더는 첫 번째 저장 시만 추가
        transforms: [({ timestamp, ...rest }) => ({ ...rest, timestamp: Number(timestamp) })]
      };

      const csvData = parse(response.data, opts); // 옵션 적용
      fs.appendFileSync(filePath, `${csvData}\n`, 'utf-8'); // 데이터 추가
      console.log(`Saved ${response.data.length} candles to ${filePath}`);

      // 호출 간격(100ms) 준수
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Error:', error.message);
      if (error.response) {
        console.error('Response Data:', error.response.data);
      }
      break;
    }
  }

  console.log(`Completed fetching 1 year of 30-minute candles. Saved to ${filePath}`);
}

// 데이터 가져오기 실행
fetchAndSaveCandles();

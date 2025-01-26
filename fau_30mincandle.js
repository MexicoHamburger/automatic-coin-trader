const fs = require('fs');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const market = 'KRW-STPT'; // 가정된 값
const count = 2; // 요청할 데이터 개수
const url = 'https://api.upbit.com/v1/candles/minutes/30'; // API URL
const filePath = 'responses/STPT-30min_candle_1year.csv';

async function fetchData(toDate) {
    const params = {
        market: market,
        count: count,
        to: toDate.toISOString().replace('T', ' ').split('.')[0],
    };

    const response = await axios.get(url, { params });
    return response.data;
}

function readCSV(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
    });
}

function writeCSV(filePath, data) {
    const csvData = stringify(data, {
        header: true,
        columns: Object.keys(data[0]),
    });
    fs.writeFileSync(filePath, csvData);
}

function mergeData(existingData, newData) {
    const merged = [...newData];

    const existingMap = new Map(existingData.map(item => [item.candle_date_time_utc, item]));
    for (const newItem of newData) {
        const existingItem = existingMap.get(newItem.candle_date_time_utc);
        if (existingItem) {
            existingMap.set(newItem.candle_date_time_utc, newItem);
        }
    }

    for (const [key, value] of existingMap.entries()) {
        if (!newData.some(item => item.candle_date_time_utc === key)) {
            merged.push(value);
        }
    }

    return merged.sort((a, b) => new Date(b.candle_date_time_utc) - new Date(a.candle_date_time_utc));
}

async function updateCSV() {
    try {
        const toDate = new Date();
        const newData = await fetchData(toDate);

        const existingData = readCSV(filePath);

        const mergedData = mergeData(existingData, newData);

        writeCSV(filePath, mergedData);

        console.log(`CSV 파일 업데이트 완료: ${filePath}`);
    } catch (error) {
        console.error('데이터 업데이트 중 오류 발생:', error);
    }
}

async function startUpdating() {
    while (true) {
        await updateCSV();
        await new Promise(resolve => setTimeout(resolve, 60000)); // 1분 대기
    }
}

startUpdating();

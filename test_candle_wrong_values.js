const fs = require('fs');
const { parse } = require('csv-parse/sync');

function calculateFilteredAverage(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
    });

    // 최신 1,000개의 데이터를 추출
    const recentRecords = records.slice(0, 1000);
    const tradeVolumes = recentRecords.map(record => parseFloat(record.candle_acc_trade_volume));

    // IQR을 기반으로 상하 경계 계산
    const sortedVolumes = [...tradeVolumes].sort((a, b) => a - b);
    const Q1 = sortedVolumes[Math.floor(sortedVolumes.length * 0.25)];
    const Q3 = sortedVolumes[Math.floor(sortedVolumes.length * 0.75)];
    const IQR = Q3 - Q1;

    const lowerBound = Math.max(0, Q1 - 1.0 * IQR);
    const upperBound = Q3 + 1.5 * IQR;

    // 이상치 제거 및 평균 계산
    const filteredVolumes = tradeVolumes.filter(volume => volume >= lowerBound && volume <= upperBound);
    const averageVolume = filteredVolumes.reduce((sum, volume) => sum + volume, 0) / filteredVolumes.length;

    return {
        lowerBound,
        upperBound,
        averageVolume,
    };
}

// 실행 코드 추가
if (require.main === module) {
    const filePath = process.argv[2]; // 파일 경로를 명령줄 인자로 받음
    if (!filePath) {
        console.error('CSV 파일 경로를 입력해주세요.');
        process.exit(1);
    }

    try {
        const result = calculateFilteredAverage(filePath);
        console.log(`IQR 하한 경계: ${result.lowerBound}`);
        console.log(`IQR 상한 경계: ${result.upperBound}`);
        console.log(`이상치 제거 후 평균값: ${result.averageVolume}`);
    } catch (error) {
        console.error('오류 발생:', error.message);
        process.exit(1);
    }
}

module.exports = {
    calculateFilteredAverage,
};
/***************************************
 * Install dependencies:
 *   npm install axios json2csv csv-parse csv-stringify
 ***************************************/
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// CSV parse/stringify
const { parse: json2csvParse } = require('json2csv');
const { parse: csvParse } = require('csv-parse/sync');
const { stringify: csvStringify } = require('csv-stringify/sync');

/***************************************
 * Step [1]: Read available markets
 ***************************************/
function getAvailableMarkets(jsonFilePath) {
    if (!fs.existsSync(jsonFilePath)) {
        throw new Error(`Market JSON file not found: ${jsonFilePath}`);
    }
    const rawData = fs.readFileSync(jsonFilePath, 'utf-8');
    const items = JSON.parse(rawData);

    // Only extract "market" from each item
    return items.map(item => item.market).filter(Boolean);
}

/***************************************
 * Step [2]-1: Full fetch (~3 months) if needed
 ***************************************/
async function fetchFullCandles(market, outCsvPath) {
    const url = 'https://api.upbit.com/v1/candles/minutes/30';
    const count = 200; // Upbit max per request
    let toDate = new Date();

    let threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(toDate.getMonth() - 3);

    // If an old CSV file exists, remove it first so we start fresh
    if (fs.existsSync(outCsvPath)) {
        fs.unlinkSync(outCsvPath);
    }
    fs.writeFileSync(outCsvPath, ''); // create an empty file

    let allData = [];
    let isFinished = false;

    console.log(`[${market}] Starting full fetch (~3 months) -> ${outCsvPath}`);
    while (!isFinished) {
        try {
            const params = {
                market: market,
                count: count,
                to: toDate.toISOString().replace('T', ' ').split('.')[0],
            };

            console.log(`[${market}] Fetching data up to: ${params.to}`);
            const response = await axios.get(url, { params });

            if (!response.data || response.data.length === 0) {
                // no more data
                isFinished = true;
                break;
            }

            // Accumulate data
            allData = allData.concat(response.data);

            // Oldest candle
            const oldest = response.data[response.data.length - 1];
            toDate = new Date(oldest.candle_date_time_utc);

            // Stop if we’ve gone past ~3 months
            if (toDate < threeMonthsAgo) {
                isFinished = true;
            }

            // Write batch to CSV
            const opts = {
                fields: Object.keys(response.data[0]),
                header: (allData.length === response.data.length), // only true on first batch
                transforms: [
                    ({ timestamp, ...rest }) => ({ ...rest, timestamp: Number(timestamp) })
                ],
            };
            const csvData = json2csvParse(response.data, opts);
            fs.appendFileSync(outCsvPath, csvData + '\n', 'utf-8');

            // Rate-limit: 100ms
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.error(`[${market}] Full fetch error: ${error.message}`);
            break;
        }
    }

    console.log(`[${market}] Completed fetching. Saved to ${outCsvPath}`);
}

/***************************************
 * Step [2]-2: Incremental update
 ***************************************/
async function updateCandles(market, outCsvPath) {
    const url = 'https://api.upbit.com/v1/candles/minutes/30';
    const count = 2; // fetch newest 2
    const toDate = new Date();

    try {
        const params = {
            market,
            count,
            to: toDate.toISOString().replace('T', ' ').split('.')[0],
        };
        const response = await axios.get(url, { params });
        const newData = response.data;

        const existingData = readCsvToObjects(outCsvPath);
        const mergedData = mergeCandleData(existingData, newData);
        writeObjectsToCsv(mergedData, outCsvPath);

    } catch (error) {
        console.error(`[${market}] Update error: ${error.message}`);
    }
}

/***************************************
 * Helper: read CSV => array of objects
 ***************************************/
function readCsvToObjects(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return csvParse(fileContent, {
        columns: true,
        skip_empty_lines: true,
    });
}

/***************************************
 * Helper: write array of objects => CSV
 ***************************************/
function writeObjectsToCsv(dataArray, filePath) {
    if (!dataArray || dataArray.length === 0) {
        return;
    }
    const csvData = csvStringify(dataArray, {
        header: true,
        columns: Object.keys(dataArray[0]),
    });
    fs.writeFileSync(filePath, csvData, 'utf-8');
}

/***************************************
 * Helper: merge data
 ***************************************/
function mergeCandleData(existingData, newData) {
    const existingMap = new Map(
        existingData.map(item => [item.candle_date_time_utc, item])
    );
    for (const nd of newData) {
        existingMap.set(nd.candle_date_time_utc, nd);
    }
    const merged = Array.from(existingMap.values());
    merged.sort((a, b) => new Date(b.candle_date_time_utc) - new Date(a.candle_date_time_utc));
    return merged;
}

/***************************************
 * Step [3]: Check volume spike
 ***************************************/
function checkVolumeSpike(market, filePath) {
    if (!fs.existsSync(filePath)) return;

    const records = readCsvToObjects(filePath);
    if (records.length === 0) return;

    // Consider only the most recent 1,000 candles
    const recent = records.slice(0, 1000);
    const volumes = recent.map(r => parseFloat(r.candle_acc_trade_volume));
    if (volumes.length < 4) return; // not enough data for IQR

    // IQR-based outlier removal
    const sorted = [...volumes].sort((a, b) => a - b);
    const Q1 = sorted[Math.floor(sorted.length * 0.25)];
    const Q3 = sorted[Math.floor(sorted.length * 0.75)];
    const IQR = Q3 - Q1;

    const lowerBound = Math.max(0, Q1 - 1.0 * IQR);
    const upperBound = Q3 + 1.5 * IQR;

    const filtered = volumes.filter(v => v >= lowerBound && v <= upperBound);
    if (filtered.length === 0) return;

    const avgVolume = filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
    const latestCandle = records[0];
    const latestVolume = parseFloat(latestCandle.candle_acc_trade_volume);

    if (latestVolume > 20 * avgVolume) {
        console.log(
            `\n[Volume Spike Detected] Market: ${market}\n` +
            ` - IQR-Filtered Avg Volume: ${avgVolume}\n` +
            ` - Latest Candle Volume:  ${latestVolume}\n`
        );
    }
}

/***************************************
 * (A) One-time: fetch full candles for
 *     any markets lacking a CSV file.
 ***************************************/
async function fetchAllMissingFullCandles(markets) {
    for (const market of markets) {
        const outCsvPath = path.join(__dirname, `responses/${market}-30min_candle_1year.csv`);

        if (!fs.existsSync(outCsvPath)) {
            // CSV doesn't exist => do full fetch once
            await fetchFullCandles(market, outCsvPath);
            // Wait 100ms to respect the 10 req/sec limit
            await new Promise(r => setTimeout(r, 100));
        }
    }
}

/***************************************
 * (B) Once per minute:
 *     For each market => update & check
 ***************************************/
async function updateAllMarkets(markets) {
    console.log(`\nStarting one update cycle at ${new Date().toLocaleTimeString()}\n`);
    for (const market of markets) {
        const outCsvPath = path.join(__dirname, `responses/${market}-30min_candle_1year.csv`);

        // Perform incremental update
        await updateCandles(market, outCsvPath);
        // Then check volume
        checkVolumeSpike(market, outCsvPath);

        // Rate limit: wait 100ms
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\nFinished one update cycle at ${new Date().toLocaleTimeString()}\n`);
}

/***************************************
 * (C) Start a scheduler:
 *   - Step 1: full fetch once if needed
 *   - Step 2: setInterval => updateAllMarkets() every 60s
 ***************************************/
async function startScheduler() {
    // 1) Get all markets
    const jsonFilePath = path.join(__dirname, 'responses/response_available_items.json');
    const markets = getAvailableMarkets(jsonFilePath);

    // 2) One-time full fetch for missing CSV
    await fetchAllMissingFullCandles(markets);

    // 3) Now schedule incremental updates + checkVolume once per minute
    console.log(`Starting incremental updates every 60 seconds...`);
    await updateAllMarkets(markets); // run once immediately

    setInterval(() => {
        updateAllMarkets(markets)
            .catch(err => console.error('Error in updateAllMarkets:', err));
    }, 60_000); // 1 minute
}

/***************************************
 * Run it
 ***************************************/
startScheduler().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
});

require('dotenv').config();
const request = require('request');
const { v4: uuidv4 } = require('uuid');
const sign = require('jsonwebtoken').sign;

const access_key = process.env.UPBIT_OPEN_API_ACCESS_KEY;
const secret_key = process.env.UPBIT_OPEN_API_SECRET_KEY;
const server_url = process.env.UPBIT_OPEN_API_SERVER_URL;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function show_account() {
    await delay(100);
    return new Promise((resolve, reject) => {
        // Generate JWT token
        const payload = {
            access_key: access_key,
            nonce: uuidv4(),
        };

        // Declare token only once
        const token = sign(payload, secret_key);

        // API request options
        const options = {
            method: "GET",
            url: `${server_url}/v1/accounts`,
            headers: { Authorization: `Bearer ${token}` }, // Correctly format Bearer token
        };

        // Perform the request
        request(options, (error, response, body) => {
            if (error) {
                reject(new Error(`API Request Failed: ${error.message}`));
                return;
            }

            try {
                const accounts = JSON.parse(body);
                const filteredAccounts = accounts.filter(
                    (account) => account.currency !== 'KRW' && account.currency !== 'APENFT'
                );

                resolve(filteredAccounts); // Return the filtered results
            } catch (parseError) {
                reject(new Error(`Failed to parse response: ${parseError.message}`));
            }
        });
    });
}

// Export the function for external use
module.exports = { show_account };

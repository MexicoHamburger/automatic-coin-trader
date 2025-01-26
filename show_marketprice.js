const request = require('request')

const server_url = "https://api.upbit.com"

const options = {
    method: "GET",
    url: server_url + "/v1/ticker",
    qs: {markets: "KRW-BTC,KRW-ETH"}
}

request(options, (error, response, body) => {
    if (error) throw new Error(error)
    console.log(body)
})
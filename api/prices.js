// api/prices.js
// Vercelのサーバーレス関数として動作するAPIプロキシ
// CORSエラーを回避してYahoo Finance・CoinGeckoからデータを取得する

export default async function handler(req, res) {
  // CORSヘッダーを設定（どのドメインからでもアクセス可能にする）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  // ↑ 60秒キャッシュ（Yahoo Financeの負荷対策・無料枠を節約）

  try {
    // ══════════════════════════════════════
    //  取得する銘柄リスト
    //  Yahoo Finance のシンボル形式
    // ══════════════════════════════════════
    const yahooSymbols = [
      'USDJPY=X',   // ドル円
      'EURJPY=X',   // ユーロ円
      'GBPJPY=X',   // ポンド円
      '^N225',      // 日経225
      '^GSPC',      // S&P500
      '^DJI',       // ダウ平均
      'GC=F',       // 金（Gold先物）
      'CL=F',       // WTI原油先物
    ];

    // Yahoo Finance API へリクエスト
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${yahooSymbols.join(',')}&range=1d&interval=5m`;

    // サマリーAPI（現在値・騰落率取得）
    const summaryUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbols.join(',')}`;

    // CoinGecko API（仮想通貨）- 登録不要・無料
    const coinUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,ripple&vs_currencies=usd,jpy&include_24hr_change=true';

    // ══ 並列でAPIリクエスト（高速化） ══
    const [yahooRes, coinRes] = await Promise.allSettled([
      fetch(summaryUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      }),
      fetch(coinUrl, {
        headers: { 'Accept': 'application/json' }
      })
    ]);

    const result = { timestamp: new Date().toISOString(), data: {} };

    // ══ Yahoo Finance データ処理 ══
    if (yahooRes.status === 'fulfilled' && yahooRes.value.ok) {
      const yahooData = await yahooRes.value.json();
      const quotes = yahooData?.quoteResponse?.result || [];

      for (const q of quotes) {
        const symbol = q.symbol;
        const price  = q.regularMarketPrice ?? null;
        const change = q.regularMarketChange ?? null;
        const changePct = q.regularMarketChangePercent ?? null;
        const prevClose = q.regularMarketPreviousClose ?? null;

        result.data[symbol] = {
          price:     price     !== null ? Math.round(price * 100) / 100 : null,
          change:    change    !== null ? Math.round(change * 100) / 100 : null,
          changePct: changePct !== null ? Math.round(changePct * 100) / 100 : null,
          prevClose: prevClose !== null ? Math.round(prevClose * 100) / 100 : null,
          currency:  q.currency ?? '',
          name:      q.shortName ?? q.longName ?? symbol,
          marketState: q.marketState ?? 'CLOSED',
        };
      }
    }

    // ══ CoinGecko データ処理 ══
    if (coinRes.status === 'fulfilled' && coinRes.value.ok) {
      const coinData = await coinRes.value.json();

      const coinMap = {
        bitcoin:  { symbol: 'BTC-USD', name: 'Bitcoin' },
        ethereum: { symbol: 'ETH-USD', name: 'Ethereum' },
        ripple:   { symbol: 'XRP-USD', name: 'XRP' },
      };

      for (const [id, info] of Object.entries(coinMap)) {
        if (!coinData[id]) continue;
        const d = coinData[id];
        result.data[info.symbol] = {
          price:     d.usd ?? null,
          priceJpy:  d.jpy ?? null,
          changePct: d.usd_24h_change !== undefined
                      ? Math.round(d.usd_24h_change * 100) / 100
                      : null,
          currency:  'USD',
          name:      info.name,
          marketState: 'REGULAR',
        };
      }
    }

    // データが1件も取れなかった場合はエラー
    if (Object.keys(result.data).length === 0) {
      return res.status(503).json({ error: 'データの取得に失敗しました。しばらく後で再試行してください。' });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'サーバーエラーが発生しました', detail: error.message });
  }
}

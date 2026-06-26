//+------------------------------------------------------------------+
//|                                              GoldSignalEA.mq4    |
//|              Universal auto-trader — any forex pair or crypto    |
//|   Polls /signal/{SYMBOL} every N seconds for HIGH/MEDIUM signals |
//|                                                                   |
//|  Place on ANY chart and the EA will trade that chart's symbol.   |
//|  Run multiple instances with different MagicNumbers for each     |
//|  pair (EURUSD=101, GBPUSD=102, USDJPY=103, XAUUSD=104, etc.)   |
//+------------------------------------------------------------------+
#property copyright "GoldSignal Bot"
#property version   "2.00"
#property strict

//--- Inputs
input string   SignalBaseURL        = "https://peaceful-courage.up.railway.app/signal";
input double   RiskPercent          = 1.0;    // Risk % of balance per trade
input double   MaxDailyLossPercent  = 3.0;    // Kill switch: halt if daily loss >= this %
input int      PollSeconds          = 15;     // Seconds between signal polls
input int      SlippagePoints       = 30;     // Max slippage in points
input int      MagicNumber          = 100001; // MUST be unique per chart/pair
input bool     TradeOnMedium        = true;   // Trade MEDIUM confidence signals (not just HIGH)

//--- Globals
string   g_symbol         = "";   // filled in OnInit from Symbol()
string   g_signalURL      = "";   // SignalBaseURL + "/" + g_symbol
string   g_lastSignalId   = "";
double   g_dayStartBal    = 0;
datetime g_dayStart       = 0;
bool     g_killed         = false;

//+------------------------------------------------------------------+
//| Init                                                              |
//+------------------------------------------------------------------+
int OnInit()
{
   g_symbol    = Symbol();
   g_signalURL = SignalBaseURL + "/" + g_symbol;

   g_dayStartBal = AccountBalance();
   g_dayStart    = TimeCurrent();
   g_killed      = false;

   EventSetTimer(PollSeconds);

   Print("═══════════════════════════════════════════════════════");
   Print("[EA] GoldSignalEA v2.0 — Universal Multi-Pair");
   Print("[EA] Symbol    : ", g_symbol);
   Print("[EA] Signal URL: ", g_signalURL);
   Print("[EA] Account   : ", AccountNumber(), "  Balance: ",
         DoubleToStr(g_dayStartBal, 2), " ", AccountCurrency());
   Print("[EA] Risk/trade: ", RiskPercent, "%  |  Daily limit: ", MaxDailyLossPercent, "%");
   Print("[EA] Poll every: ", PollSeconds, "s  |  MagicNumber: ", MagicNumber);
   Print("[EA] TradeOnMedium: ", TradeOnMedium ? "YES" : "NO");
   Print("═══════════════════════════════════════════════════════");

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[EA] ", g_symbol, " EA stopped (reason: ", reason, ")");
}

//+------------------------------------------------------------------+
//| Timer — main polling loop                                         |
//+------------------------------------------------------------------+
void OnTimer()
{
   //--- Reset daily tracking at midnight
   if (TimeDay(TimeCurrent()) != TimeDay(g_dayStart))
   {
      g_dayStartBal = AccountBalance();
      g_dayStart    = TimeCurrent();
      g_killed      = false;
      Print("[EA] ", g_symbol, " — New trading day, balance reset to ",
            DoubleToStr(g_dayStartBal, 2));
   }

   //--- Kill switch
   if (g_killed)
   {
      Print("[EA] ", g_symbol, " ⛔ KILL SWITCH ACTIVE — skipping");
      return;
   }

   double lossToday = g_dayStartBal - AccountBalance();
   double lossPct   = (g_dayStartBal > 0) ? lossToday / g_dayStartBal * 100.0 : 0.0;
   if (lossPct >= MaxDailyLossPercent)
   {
      g_killed = true;
      Print("[EA] ", g_symbol, " ⛔ KILL SWITCH — daily loss ",
            DoubleToStr(lossPct, 2), "% >= limit ", MaxDailyLossPercent, "%. Closing all.");
      CloseAll();
      return;
   }

   PollAndTrade();
}

//+------------------------------------------------------------------+
//| Poll Railway and execute signal                                   |
//+------------------------------------------------------------------+
void PollAndTrade()
{
   char   post[];
   char   result[];
   string resHeaders;
   string reqHeaders = "Accept: application/json\r\n";

   int status = WebRequest("GET", g_signalURL, reqHeaders, 5000, post, result, resHeaders);

   if (status == -1)
   {
      int err = GetLastError();
      if (err == 4060)
         Print("[EA] WebRequest blocked — add URL to: Tools > Options > Expert Advisors > Allow WebRequest: ", g_signalURL);
      else
         Print("[EA] ", g_symbol, " WebRequest error=", err);
      return;
   }
   if (status != 200)
   {
      Print("[EA] ", g_symbol, " HTTP ", status, " from signal endpoint");
      return;
   }

   string json = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   string signalId  = JStr(json, "signal_id");
   string direction = JStr(json, "direction");
   string conf      = JStr(json, "confidence");
   double entry     = JDbl(json, "entry");
   double sl        = JDbl(json, "stopLoss");
   double tp1       = JDbl(json, "takeProfit1");

   if (signalId == "")
   {
      Print("[EA] ", g_symbol, " — could not parse signal_id: ", StringSubstr(json, 0, 120));
      return;
   }

   //--- Skip already-acted signals
   if (signalId == g_lastSignalId) return;

   Print("[EA] ── ", g_symbol, " NEW SIGNAL ───────────────────────────");
   Print("[EA] ID: ", signalId, "  Dir: ", direction, "  Conf: ", conf);
   Print("[EA] Entry: ", entry, "  SL: ", sl, "  TP1: ", tp1);

   g_lastSignalId = signalId;

   //--- Confidence gate
   if (conf == "HIGH" || (TradeOnMedium && conf == "MEDIUM"))
   {
      if (direction == "LONG")
      {
         CloseAll();
         OpenBuy(entry, sl, tp1);
      }
      else if (direction == "SHORT")
      {
         CloseAll();
         OpenSell(entry, sl, tp1);
      }
      else if (direction == "WAIT")
      {
         Print("[EA] ", g_symbol, " WAIT — closing position if any");
         CloseAll();
      }
   }
   else if (direction != "WAIT")
   {
      Print("[EA] ", g_symbol, " skipping — confidence=", conf);
   }
}

//+------------------------------------------------------------------+
//| Position sizing: risk % of balance / SL distance                 |
//+------------------------------------------------------------------+
double CalcLots(double entryPrice, double slPrice)
{
   double balance    = AccountBalance();
   double riskAmount = balance * RiskPercent / 100.0;
   double slDist     = MathAbs(entryPrice - slPrice);

   if (slDist <= 0)
   {
      Print("[EA] ", g_symbol, " SL distance = 0 — cannot size");
      return 0;
   }

   double tickVal  = MarketInfo(g_symbol, MODE_TICKVALUE);
   double tickSize = MarketInfo(g_symbol, MODE_TICKSIZE);

   if (tickVal <= 0 || tickSize <= 0)
   {
      Print("[EA] ", g_symbol, " invalid tick info — tickVal=", tickVal, " tickSize=", tickSize);
      return 0;
   }

   double lots    = riskAmount / (slDist / tickSize * tickVal);
   double minLot  = MarketInfo(g_symbol, MODE_MINLOT);
   double maxLot  = MarketInfo(g_symbol, MODE_MAXLOT);
   double lotStep = MarketInfo(g_symbol, MODE_LOTSTEP);

   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(minLot, MathMin(maxLot, lots));

   Print("[EA] ", g_symbol, " lots=", DoubleToStr(lots, 2),
         "  risk=", DoubleToStr(riskAmount, 2),
         "  SLdist=", DoubleToStr(slDist, Digits));
   return lots;
}

//+------------------------------------------------------------------+
//| Open BUY                                                          |
//+------------------------------------------------------------------+
void OpenBuy(double entry, double sl, double tp)
{
   double lots = CalcLots(entry, sl);
   if (lots <= 0) return;

   double price = NormalizeDouble(Ask, Digits);
   sl  = NormalizeDouble(sl,  Digits);
   tp  = NormalizeDouble(tp,  Digits);

   int ticket = OrderSend(g_symbol, OP_BUY, lots, price, SlippagePoints,
                          sl, tp, "GoldSignalBot", MagicNumber, 0, clrGreen);
   if (ticket < 0)
      Print("[EA] ", g_symbol, " BUY FAILED error=", GetLastError());
   else
      Print("[EA] ", g_symbol, " ✅ BUY #", ticket,
            " lots=", lots, " price=", price, " SL=", sl, " TP=", tp);
}

//+------------------------------------------------------------------+
//| Open SELL                                                         |
//+------------------------------------------------------------------+
void OpenSell(double entry, double sl, double tp)
{
   double lots = CalcLots(entry, sl);
   if (lots <= 0) return;

   double price = NormalizeDouble(Bid, Digits);
   sl  = NormalizeDouble(sl,  Digits);
   tp  = NormalizeDouble(tp,  Digits);

   int ticket = OrderSend(g_symbol, OP_SELL, lots, price, SlippagePoints,
                          sl, tp, "GoldSignalBot", MagicNumber, 0, clrRed);
   if (ticket < 0)
      Print("[EA] ", g_symbol, " SELL FAILED error=", GetLastError());
   else
      Print("[EA] ", g_symbol, " ✅ SELL #", ticket,
            " lots=", lots, " price=", price, " SL=", sl, " TP=", tp);
}

//+------------------------------------------------------------------+
//| Close all positions for this symbol + magic number               |
//+------------------------------------------------------------------+
void CloseAll()
{
   for (int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderSymbol()      != g_symbol)   continue;
      if (OrderMagicNumber() != MagicNumber) continue;

      bool ok = false;
      if      (OrderType() == OP_BUY)  ok = OrderClose(OrderTicket(), OrderLots(), Bid, SlippagePoints, clrNONE);
      else if (OrderType() == OP_SELL) ok = OrderClose(OrderTicket(), OrderLots(), Ask, SlippagePoints, clrNONE);

      if (ok) Print("[EA] ", g_symbol, " Closed #", OrderTicket());
      else    Print("[EA] ", g_symbol, " Close FAILED #", OrderTicket(), " err=", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| JSON helpers — no DLLs, no external libraries                    |
//|   JStr(json, key) → string value                                 |
//|   JDbl(json, key) → double value                                 |
//+------------------------------------------------------------------+
string JStr(const string json, const string key)
{
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if (p < 0) return "";

   int c = StringFind(json, ":", p + StringLen(pat));
   if (c < 0) return "";

   int s = c + 1;
   while (s < StringLen(json) && StringSubstr(json, s, 1) == " ") s++;

   if (StringSubstr(json, s, 1) == "\"")
   {
      s++;
      int e = StringFind(json, "\"", s);
      if (e < 0) return "";
      return StringSubstr(json, s, e - s);
   }

   // bare value (number, bool, null)
   int e = s;
   while (e < StringLen(json))
   {
      string ch = StringSubstr(json, e, 1);
      if (ch == "," || ch == "}" || ch == "]" || ch == "\r" || ch == "\n") break;
      e++;
   }
   return StringTrimRight(StringTrimLeft(StringSubstr(json, s, e - s)));
}

double JDbl(const string json, const string key)
{
   string v = JStr(json, key);
   if (v == "" || v == "null") return 0.0;
   return StringToDouble(v);
}

void OnTick() {} // timer-driven — OnTick intentionally unused
//+------------------------------------------------------------------+

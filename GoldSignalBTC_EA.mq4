//+------------------------------------------------------------------+
//|                                        GoldSignalBTC_EA.mq4     |
//|                        Auto-trader for BTC/USD via Railway       |
//|                  Polls webhook every 10s for HIGH/MEDIUM signals |
//+------------------------------------------------------------------+
#property copyright "GoldSignal Bot"
#property version   "1.00"
#property strict

//--- Editable inputs
input string   SignalURL            = "https://peaceful-courage.up.railway.app/btc-signal";
input double   RiskPercent          = 1.0;     // Risk % of balance per trade
input double   MaxDailyLossPercent  = 3.0;     // Kill switch: halt if daily loss >= this %
input int      PollSeconds          = 10;      // Seconds between signal polls
input int      SlippagePoints       = 30;      // Max slippage in points
input int      MagicNumber          = 778899;  // Unique EA identifier

//--- Globals
string   g_lastSignalId    = "";
double   g_dayStartBalance = 0;
datetime g_dayStart        = 0;
bool     g_killed          = false;

//+------------------------------------------------------------------+
//| Init                                                              |
//+------------------------------------------------------------------+
int OnInit()
{
   g_dayStartBalance = AccountBalance();
   g_dayStart        = TimeCurrent();
   g_killed          = false;

   EventSetTimer(PollSeconds);

   Print("═══════════════════════════════════════════");
   Print("[EA] GoldSignalBTC_EA v1.0 started");
   Print("[EA] Symbol   : ", Symbol());
   Print("[EA] Account  : ", AccountNumber());
   Print("[EA] Balance  : ", DoubleToStr(g_dayStartBalance, 2), " ", AccountCurrency());
   Print("[EA] Risk/trade: ", RiskPercent, "%  |  Daily limit: ", MaxDailyLossPercent, "%");
   Print("[EA] Polling  : ", SignalURL, " every ", PollSeconds, "s");
   Print("═══════════════════════════════════════════");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[EA] Stopped (reason: ", reason, ")");
}

//+------------------------------------------------------------------+
//| Timer — main loop                                                 |
//+------------------------------------------------------------------+
void OnTimer()
{
   //--- Reset daily tracking at midnight
   if (TimeDay(TimeCurrent()) != TimeDay(g_dayStart))
   {
      g_dayStartBalance = AccountBalance();
      g_dayStart        = TimeCurrent();
      g_killed          = false;
      Print("[EA] New trading day — balance reset to ", DoubleToStr(g_dayStartBalance, 2));
   }

   //--- Kill switch
   if (g_killed)
   {
      Print("[EA] ⛔ KILL SWITCH ACTIVE — no trading today");
      return;
   }

   double lossToday = g_dayStartBalance - AccountBalance();
   double lossPct   = (g_dayStartBalance > 0) ? lossToday / g_dayStartBalance * 100.0 : 0;
   if (lossPct >= MaxDailyLossPercent)
   {
      g_killed = true;
      Print("[EA] ⛔ KILL SWITCH — daily loss ", DoubleToStr(lossPct, 2),
            "% exceeded ", MaxDailyLossPercent, "% limit. Closing all positions.");
      CloseAll();
      return;
   }

   PollAndTrade();
}

//+------------------------------------------------------------------+
//| Poll Railway webhook and execute signal                          |
//+------------------------------------------------------------------+
void PollAndTrade()
{
   char   post[];
   char   result[];
   string resHeaders;
   string reqHeaders = "Accept: application/json\r\n";

   int status = WebRequest("GET", SignalURL, reqHeaders, 5000, post, result, resHeaders);

   if (status == -1)
   {
      Print("[EA] WebRequest error=", GetLastError(),
            " — add ", SignalURL, " to: Tools > Options > Expert Advisors > Allow WebRequest");
      return;
   }
   if (status != 200)
   {
      Print("[EA] HTTP ", status, " from webhook");
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
      Print("[EA] Could not parse signal_id — raw: ", StringSubstr(json, 0, 120));
      return;
   }

   //--- Deduplicate: skip if same signal_id as last trade
   if (signalId == g_lastSignalId)
      return;

   Print("[EA] ── NEW SIGNAL ──────────────────────────────");
   Print("[EA] ID: ", signalId, "  Dir: ", direction, "  Conf: ", conf);
   Print("[EA] Entry: ", entry, "  SL: ", sl, "  TP1: ", tp1);

   g_lastSignalId = signalId;

   //--- Only act on HIGH or MEDIUM confidence
   if (conf != "HIGH" && conf != "MEDIUM")
   {
      Print("[EA] Skipping — confidence=", conf);
      return;
   }

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
      Print("[EA] WAIT — closing any open position");
      CloseAll();
   }
   else
   {
      Print("[EA] Unknown direction: ", direction);
   }
}

//+------------------------------------------------------------------+
//| Lot size from risk %                                              |
//+------------------------------------------------------------------+
double CalcLots(double entryPrice, double slPrice)
{
   double balance    = AccountBalance();
   double riskAmount = balance * RiskPercent / 100.0;
   double slDist     = MathAbs(entryPrice - slPrice);

   if (slDist <= 0)
   {
      Print("[EA] SL distance is zero — cannot size position");
      return 0;
   }

   double tickVal  = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize = MarketInfo(Symbol(), MODE_TICKSIZE);

   if (tickVal <= 0 || tickSize <= 0)
   {
      Print("[EA] Invalid tick info for ", Symbol(), " — tickVal=", tickVal, " tickSize=", tickSize);
      return 0;
   }

   double lots    = riskAmount / (slDist / tickSize * tickVal);
   double minLot  = MarketInfo(Symbol(), MODE_MINLOT);
   double maxLot  = MarketInfo(Symbol(), MODE_MAXLOT);
   double lotStep = MarketInfo(Symbol(), MODE_LOTSTEP);

   lots = MathFloor(lots / lotStep) * lotStep;
   lots = MathMax(minLot, MathMin(maxLot, lots));

   Print("[EA] Risk calc → balance=", DoubleToStr(balance,2),
         "  risk=", DoubleToStr(riskAmount,2),
         "  SLdist=", DoubleToStr(slDist,5),
         "  lots=", DoubleToStr(lots,2));
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

   int ticket = OrderSend(Symbol(), OP_BUY, lots, price, SlippagePoints,
                          sl, tp, "GoldSignalBot", MagicNumber, 0, clrGreen);
   if (ticket < 0)
      Print("[EA] BUY FAILED — error=", GetLastError());
   else
      Print("[EA] ✅ BUY #", ticket, " | lots=", lots, " price=", price, " SL=", sl, " TP=", tp);
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

   int ticket = OrderSend(Symbol(), OP_SELL, lots, price, SlippagePoints,
                          sl, tp, "GoldSignalBot", MagicNumber, 0, clrRed);
   if (ticket < 0)
      Print("[EA] SELL FAILED — error=", GetLastError());
   else
      Print("[EA] ✅ SELL #", ticket, " | lots=", lots, " price=", price, " SL=", sl, " TP=", tp);
}

//+------------------------------------------------------------------+
//| Close all open positions for this symbol + magic number          |
//+------------------------------------------------------------------+
void CloseAll()
{
   for (int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if (!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if (OrderSymbol()      != Symbol())      continue;
      if (OrderMagicNumber() != MagicNumber)   continue;

      bool ok = false;
      if      (OrderType() == OP_BUY)  ok = OrderClose(OrderTicket(), OrderLots(), Bid, SlippagePoints, clrNONE);
      else if (OrderType() == OP_SELL) ok = OrderClose(OrderTicket(), OrderLots(), Ask, SlippagePoints, clrNONE);

      if (ok) Print("[EA] Closed #", OrderTicket());
      else    Print("[EA] Close failed #", OrderTicket(), " error=", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| Minimal JSON helpers — no external libraries needed              |
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

void OnTick() {} // timer-driven — tick not used
//+------------------------------------------------------------------+

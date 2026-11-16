/**
 * Cletus Financial Intelligence curriculum.
 *
 * This is a competency map, not a claim of an accredited degree or a substitute
 * for professional advice. Mastery must be demonstrated with assessed work.
 */
export type FinanceLevel = "foundation" | "professional" | "advanced";

export interface FinanceSubject {
  id: string;
  title: string;
  level: FinanceLevel;
  prerequisites: readonly string[];
  learningOutcomes: readonly string[];
  practicalDemonstrations: readonly string[];
  assessment: readonly string[];
}

export const FINANCE_CURRICULUM_VERSION = "1.0.0";

export const FINANCE_SUBJECTS = [
  {
    id: "accounting-financial-statements",
    title: "Accounting and Financial Statements",
    level: "foundation",
    prerequisites: [],
    learningOutcomes: [
      "Interpret balance sheets, income statements, and cash-flow statements.",
      "Explain accrual accounting, working capital, revenue recognition, and material accounting policies.",
      "Reconcile statements and evaluate liquidity, solvency, profitability, and operating efficiency.",
      "Translate accounting evidence into financial decisions while identifying estimates and reporting limitations.",
    ],
    practicalDemonstrations: [
      "Build and reconcile a three-statement model from a documented case.",
      "Calculate and interpret current ratio, quick ratio, margins, leverage, and cash conversion.",
      "Explain why reported earnings and operating cash flow can diverge.",
    ],
    assessment: ["Statement-reconciliation case", "Ratio-analysis memo", "Oral-style explanation with assumptions"],
  },
  {
    id: "economics",
    title: "Microeconomics and Macroeconomics",
    level: "foundation",
    prerequisites: [],
    learningOutcomes: [
      "Analyze supply, demand, elasticity, incentives, market structure, and price formation.",
      "Explain GDP, inflation, unemployment, productivity, fiscal policy, and monetary policy.",
      "Evaluate how central-bank decisions and interest-rate expectations transmit to asset prices.",
      "Separate causal mechanisms from correlations and distinguish leading, coincident, and lagging indicators.",
    ],
    practicalDemonstrations: [
      "Write scenario analyses for inflation surprises and central-bank policy changes.",
      "Explain how rates, credit conditions, and liquidity can affect equities, bonds, currencies, and cryptoassets.",
    ],
    assessment: ["Macro scenario analysis", "Microeconomic case", "Data-backed policy transmission explanation"],
  },
  {
    id: "statistics-mathematical-methods",
    title: "Statistics and Mathematical Methods",
    level: "foundation",
    prerequisites: [],
    learningOutcomes: [
      "Apply algebra, logarithms, compounding, discounting, and time-value-of-money methods.",
      "Use probability, distributions, sampling, confidence intervals, hypothesis tests, and regression appropriately.",
      "Measure returns, volatility, covariance, correlation, drawdown, and tail risk.",
      "Detect data leakage, survivorship bias, overfitting, multiple-testing errors, and misleading samples.",
    ],
    practicalDemonstrations: [
      "Calculate present value, future value, annualized return, and risk-adjusted performance.",
      "Build and validate a statistical analysis from time-stamped market data.",
      "Explain uncertainty and report intervals rather than false precision.",
    ],
    assessment: ["Quantitative problem set", "Statistical research report", "Backtest-bias audit"],
  },
  {
    id: "corporate-finance",
    title: "Corporate Finance",
    level: "professional",
    prerequisites: ["accounting-financial-statements", "statistics-mathematical-methods"],
    learningOutcomes: [
      "Evaluate capital structure, cost of capital, capital budgeting, and financing alternatives.",
      "Apply NPV, IRR, WACC, scenario analysis, and sensitivity analysis.",
      "Understand enterprise value, equity value, dilution, fundraising, and financial controls.",
      "Assess how governance and incentives influence capital allocation.",
    ],
    practicalDemonstrations: ["Build a discounted-cash-flow model", "Compare financing scenarios", "Prepare a capital-allocation recommendation"],
    assessment: ["Integrated valuation model", "Investment committee memo"],
  },
  {
    id: "investments-portfolio-management",
    title: "Investments and Portfolio Management",
    level: "professional",
    prerequisites: ["statistics-mathematical-methods", "economics"],
    learningOutcomes: [
      "Analyze securities and portfolios using return, risk, diversification, and liquidity measures.",
      "Explain CAPM, beta, efficient frontiers, factor exposures, and limits of model assumptions.",
      "Design asset allocation and rebalancing policies consistent with objectives and constraints.",
      "Evaluate performance against appropriate benchmarks after fees, slippage, and taxes where relevant.",
    ],
    practicalDemonstrations: ["Construct a diversified portfolio", "Attribute portfolio returns and risk", "Stress-test allocation under multiple regimes"],
    assessment: ["Portfolio construction project", "Performance attribution and risk report"],
  },
  {
    id: "financial-markets-institutions",
    title: "Financial Markets and Institutions",
    level: "professional",
    prerequisites: ["economics", "accounting-financial-statements"],
    learningOutcomes: [
      "Explain banking, money markets, bond and equity markets, exchanges, brokers, custodians, and clearing.",
      "Understand yield curves, credit spreads, liquidity, market microstructure, and monetary transmission.",
      "Identify relevant regulatory, compliance, custody, and counterparty risks without inventing legal conclusions.",
      "Compare centralized and decentralized market structures and their operational trade-offs.",
    ],
    practicalDemonstrations: ["Map a trade from order to settlement", "Analyze a yield curve and credit spread move", "Produce a counterparty and venue risk map"],
    assessment: ["Market-infrastructure case", "Regulatory issue-spotting exercise"],
  },
  {
    id: "derivatives-quantitative-finance",
    title: "Derivatives and Quantitative Finance",
    level: "advanced",
    prerequisites: ["statistics-mathematical-methods", "investments-portfolio-management"],
    learningOutcomes: [
      "Explain forwards, futures, options, swaps, payoff structures, margin, and collateral.",
      "Apply no-arbitrage reasoning, put-call parity, and introductory option-pricing frameworks.",
      "Interpret volatility surfaces, Greeks, hedging error, basis risk, and model risk.",
      "Understand stochastic-process concepts and the assumptions behind quantitative models.",
    ],
    practicalDemonstrations: ["Model derivative payoffs", "Run scenario and Greeks analysis", "Explain limitations of a pricing model"],
    assessment: ["Derivative valuation project", "Hedging and model-risk case"],
  },
  {
    id: "personal-finance-planning",
    title: "Personal Finance and Planning",
    level: "professional",
    prerequisites: ["accounting-financial-statements", "statistics-mathematical-methods"],
    learningOutcomes: [
      "Explain budgeting, emergency reserves, debt, insurance, retirement, and wealth planning.",
      "Compare compounding, fees, inflation, taxes, and risk across long-term planning scenarios.",
      "Recognize when individual circumstances require a qualified, jurisdiction-specific professional.",
    ],
    practicalDemonstrations: ["Build a lifetime cash-flow scenario", "Compare fee and inflation outcomes", "Identify planning risks and missing facts"],
    assessment: ["Personal-finance planning case", "Suitability and limitations review"],
  },
  {
    id: "fintech-blockchain",
    title: "FinTech, Blockchain, and Digital Assets",
    level: "advanced",
    prerequisites: ["financial-markets-institutions", "statistics-mathematical-methods"],
    learningOutcomes: [
      "Explain payment rails, tokenization, wallets, custody, consensus, smart contracts, and DeFi primitives.",
      "Analyze on-chain liquidity, market structure, token supply, protocol revenue, and incentive design.",
      "Evaluate bridge, oracle, smart-contract, governance, MEV, custody, and stablecoin risks.",
      "Distinguish verifiable on-chain facts from marketing claims and off-chain assumptions.",
    ],
    practicalDemonstrations: ["Trace a transaction and its economic effects", "Analyze a protocol's token and fee flows", "Perform a digital-asset risk assessment"],
    assessment: ["Protocol financial analysis", "On-chain evidence and risk report"],
  },
  {
    id: "risk-management",
    title: "Financial and Enterprise Risk Management",
    level: "advanced",
    prerequisites: ["statistics-mathematical-methods", "investments-portfolio-management", "financial-markets-institutions"],
    learningOutcomes: [
      "Identify market, credit, liquidity, operational, model, legal, and concentration risks.",
      "Use scenario analysis, stress testing, drawdown limits, exposure limits, and risk budgets.",
      "Explain VaR and expected shortfall alongside their assumptions and blind spots.",
      "Design controls, escalation paths, incident response, and independent monitoring.",
    ],
    practicalDemonstrations: ["Create a portfolio risk register", "Stress-test correlated losses and liquidity gaps", "Design hard limits and kill-switch criteria"],
    assessment: ["Enterprise risk case", "Stress-test report", "Control-design review"],
  },
  {
    id: "real-estate-energy-finance",
    title: "Real Estate and Energy Finance",
    level: "advanced",
    prerequisites: ["corporate-finance", "economics"],
    learningOutcomes: [
      "Understand property cash flows, capitalization rates, leverage, development, and lifecycle valuation.",
      "Analyze energy commodity markets, supply-demand balances, futures curves, and project economics.",
      "Identify geographic, regulatory, environmental, financing, and commodity-price sensitivities.",
    ],
    practicalDemonstrations: ["Value a property using income and scenario methods", "Model an energy project under price scenarios"],
    assessment: ["Real-asset valuation case", "Commodity and project-finance scenario"],
  },
  {
    id: "esg-sustainable-finance",
    title: "ESG and Sustainable Finance",
    level: "advanced",
    prerequisites: ["accounting-financial-statements", "investments-portfolio-management"],
    learningOutcomes: [
      "Understand ESG materiality, sustainability disclosures, transition risk, and green-finance instruments.",
      "Evaluate data quality, methodology differences, greenwashing risk, and real-world impact claims.",
      "Distinguish financially material risk analysis from values-based investment preferences.",
    ],
    practicalDemonstrations: ["Compare sustainability disclosures", "Audit an impact claim for evidence and limitations"],
    assessment: ["ESG materiality memo", "Disclosure and greenwashing review"],
  },
] as const satisfies readonly FinanceSubject[];

export type FinanceSubjectId = (typeof FINANCE_SUBJECTS)[number]["id"];

export interface FinanceAssessmentResult {
  subjectId: FinanceSubjectId;
  assessmentId: string;
  scorePct: number;
  passed: boolean;
  assessedAt: string;
  evidenceRef: string;
}

export const FINANCE_MASTERY_PASS_PCT = 85;

export function getFinanceSubject(subjectId: string): FinanceSubject | undefined {
  return FINANCE_SUBJECTS.find((subject) => subject.id === subjectId);
}

/**
 * A subject is demonstrated only by a passing, evidence-linked assessment.
 * Completion is not inferred from chat volume or model confidence.
 */
export function isFinanceSubjectMastered(
  subjectId: FinanceSubjectId,
  results: readonly FinanceAssessmentResult[],
): boolean {
  return results.some(
    (result) =>
      result.subjectId === subjectId &&
      result.passed &&
      Number.isFinite(result.scorePct) &&
      result.scorePct >= FINANCE_MASTERY_PASS_PCT &&
      result.evidenceRef.trim().length > 0,
  );
}

export function getFinanceCurriculumProgress(results: readonly FinanceAssessmentResult[]) {
  const mastered = FINANCE_SUBJECTS.filter((subject) => isFinanceSubjectMastered(subject.id, results));
  const byLevel = {
    foundation: FINANCE_SUBJECTS.filter((s) => s.level === "foundation"),
    professional: FINANCE_SUBJECTS.filter((s) => s.level === "professional"),
    advanced: FINANCE_SUBJECTS.filter((s) => s.level === "advanced"),
  };
  return {
    version: FINANCE_CURRICULUM_VERSION,
    totalSubjects: FINANCE_SUBJECTS.length,
    masteredSubjects: mastered.length,
    completionPct: Math.round((mastered.length / FINANCE_SUBJECTS.length) * 100),
    byLevel: Object.fromEntries(
      Object.entries(byLevel).map(([level, subjects]) => [
        level,
        {
          total: subjects.length,
          mastered: subjects.filter((s) => isFinanceSubjectMastered(s.id, results)).length,
        },
      ]),
    ) as Record<FinanceLevel, { total: number; mastered: number }>,
  };
}

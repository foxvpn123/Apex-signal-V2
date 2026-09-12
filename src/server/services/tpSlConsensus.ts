export function calculateTpSlConsensus(
  currentPrice: number,
  validEvidence: any[],
  deterministicCandidates: any[],
  minRr = 1.5
) {
  const proposals: any[] = [];
  
  // Collect proposals from evidence
  validEvidence.forEach(v => {
    if (v.decision === "LONG" || v.decision === "SHORT") {
      if (v.entry && v.sl && v.tp1) {
        proposals.push({
          source: v.model || v.provider,
          direction: v.decision,
          entry: Number(v.entry),
          sl: Number(v.sl),
          tp1: Number(v.tp1),
          tp2: v.tp2 ? Number(v.tp2) : null,
          tp3: v.tp3 ? Number(v.tp3) : null,
          confidence: Number(v.confidence) || 50,
          weight: 1, // base weight
        });
      }
    }
  });

  // Add deterministic candidates
  deterministicCandidates.forEach(dc => {
    if (dc.direction && dc.entry && dc.sl && dc.tp1) {
      proposals.push({
        source: "DETERMINISTIC",
        direction: dc.direction,
        entry: Number(dc.entry),
        sl: Number(dc.sl),
        tp1: Number(dc.tp1),
        tp2: dc.tp2 ? Number(dc.tp2) : null,
        tp3: dc.tp3 ? Number(dc.tp3) : null,
        confidence: 80, // high confidence for deterministic
        weight: 1.5,
      });
    }
  });

  // Filter impossible combinations and invalid RR
  const validProposals = proposals.filter(p => {
    if (p.entry <= 0 || p.sl <= 0 || p.tp1 <= 0) return false;
    const risk = Math.abs(p.entry - p.sl);
    if (risk === 0) return false;
    const reward = Math.abs(p.tp1 - p.entry);
    const rr = reward / risk;
    if (rr < minRr) return false;

    // Check distance from current price
    const entryDist = Math.abs(p.entry - currentPrice) / currentPrice;
    if (entryDist > 0.05) return false; // entry too far

    if (p.direction === "LONG") {
      if (p.sl >= p.entry) return false;
      if (p.tp1 <= p.entry) return false;
      if (p.tp2 != null && p.tp2 <= p.tp1) return false;
      if (p.tp3 != null && p.tp2 != null && p.tp3 < p.tp2) return false;
    } else if (p.direction === "SHORT") {
      if (p.sl <= p.entry) return false;
      if (p.tp1 >= p.entry) return false;
      if (p.tp2 != null && p.tp2 >= p.tp1) return false;
      if (p.tp3 != null && p.tp2 != null && p.tp3 > p.tp2) return false;
    }

    return true;
  });

  if (validProposals.length === 0) {
    return { error: "NO_VALID_PROPOSALS", validProposals: [] };
  }

  // Count longs vs shorts
  let longWeight = 0;
  let shortWeight = 0;
  validProposals.forEach(p => {
    if (p.direction === "LONG") longWeight += p.confidence * p.weight;
    if (p.direction === "SHORT") shortWeight += p.confidence * p.weight;
  });

  const dominantDirection = longWeight > shortWeight ? "LONG" : "SHORT";
  const directionalProposals = validProposals.filter(p => p.direction === dominantDirection);

  if (directionalProposals.length === 0) {
    return { error: "NO_PROPOSALS_FOR_DOMINANT_DIRECTION", validProposals: [] };
  }

  // Calculate weighted median for clusters
  const getWeightedMedian = (values: {val: number, weight: number}[]) => {
    values.sort((a, b) => a.val - b.val);
    const totalWeight = values.reduce((sum, v) => sum + v.weight, 0);
    let halfWeight = totalWeight / 2;
    for (const v of values) {
      halfWeight -= v.weight;
      if (halfWeight <= 0) return v.val;
    }
    return values[values.length - 1].val;
  };

  const getMedianForField = (field: "entry" | "sl" | "tp1" | "tp2" | "tp3") => {
    const values = directionalProposals
      .filter(p => p[field] != null)
      .map(p => ({ val: p[field], weight: p.confidence * p.weight }));
    
    if (values.length === 0) return null;
    return getWeightedMedian(values);
  };

  const entry = getMedianForField("entry");
  const sl = getMedianForField("sl");
  const tp1 = getMedianForField("tp1");
  const tp2 = getMedianForField("tp2");
  const tp3 = getMedianForField("tp3");

  let rr = null;
  if (entry && sl && tp1) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp1 - entry);
    if (risk > 0) {
      rr = reward / risk;
    }
  }

  let strength = 0;
  if (directionalProposals.length > 0) {
    strength = Math.min(100, Math.round((directionalProposals.length / Math.max(1, validEvidence.length)) * 100));
  }

  return {
    direction: dominantDirection,
    entry,
    sl,
    tp1,
    tp2,
    tp3,
    rr,
    consensusStrength: strength,
    supportingModels: directionalProposals.length,
    sourceCount: proposals.length,
    validProposals: validProposals // to send to UI
  };
}

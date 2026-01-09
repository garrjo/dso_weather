/**
 * DSO Weather - Inversion Mode Test
 * Tests the Bomb Cyclone detection logic
 */

const { DSOWeatherEngine } = require('./DSOWeatherEngine.js');

const engine = new DSOWeatherEngine();

console.log("═══════════════════════════════════════════════════════════════");
console.log("           DSO WEATHER - INVERSION MODE ANALYSIS");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

// Test dates that should trigger inversion
const testCases = [
  { day: 305, name: 'November 1', expect: 'INVERSION' },   // Low sun, high catalyst
  { day: 320, name: 'November 16', expect: 'INVERSION' }, // Peak fall inversion window
  { day: 45,  name: 'February 14', expect: 'INVERSION' }, // Late winter inversion
  { day: 60,  name: 'March 1', expect: 'INVERSION' },     // Early spring inversion
  { day: 105, name: 'April 15', expect: 'CONVECTIVE' },   // Standard tornado season
  { day: 172, name: 'June 21', expect: 'SUPPRESSED' },    // Summer solstice
  { day: 355, name: 'December 21', expect: 'DORMANT' },   // Winter solstice
];

const regions = ['northern_plains', 'great_lakes', 'new_england', 'alaska_se'];

console.log("┌────────────────────────────────────────────────────────────────────┐");
console.log("│                    INVERSION DETECTION TEST                        │");
console.log("├────────────────────────────────────────────────────────────────────┤");
console.log("");

for (const tc of testCases) {
  console.log(`═══ ${tc.name} (Day ${tc.day}) - Expected: ${tc.expect} ═══`);
  console.log("");
  
  for (const region of regions) {
    const result = engine.getFullForecast(region, tc.day);
    
    const match = result.inversion.mode === tc.expect ? '✓' : '✗';
    
    console.log(`  ${match} ${engine.REGIONAL_FUEL[region].name} (${result.latitude}°N)`);
    console.log(`    Solar α: ${result.factors.solarAngle.toFixed(3)} | Catalyst: ${result.factors.catalyst.toFixed(3)}`);
    console.log(`    Mode: ${result.inversion.mode} | Type: ${result.inversion.type}`);
    console.log(`    Potential: ${result.inversion.potential.toFixed(3)}`);
    console.log(`    Primary Threat: ${result.primaryThreat}`);
    console.log("");
  }
  console.log("");
}

// Detailed look at the inversion window
console.log("═══════════════════════════════════════════════════════════════");
console.log("           ANNUAL INVERSION POTENTIAL - NORTHERN PLAINS");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

const months = [
  { name: 'Jan', day: 15 },
  { name: 'Feb', day: 46 },
  { name: 'Mar', day: 75 },
  { name: 'Apr', day: 105 },
  { name: 'May', day: 135 },
  { name: 'Jun', day: 166 },
  { name: 'Jul', day: 196 },
  { name: 'Aug', day: 227 },
  { name: 'Sep', day: 258 },
  { name: 'Oct', day: 288 },
  { name: 'Nov', day: 319 },
  { name: 'Dec', day: 349 }
];

console.log("Month | Solar α | Catalyst | Mode       | Potential | Type");
console.log("──────┼─────────┼──────────┼────────────┼───────────┼─────────────");

for (const m of months) {
  const result = engine.getFullForecast('northern_plains', m.day);
  const inv = result.inversion;
  
  console.log(
    `${m.name.padEnd(5)} | ${result.factors.solarAngle.toFixed(3).padEnd(7)} | ` +
    `${result.factors.catalyst.toFixed(3).padEnd(8)} | ${inv.mode.padEnd(10)} | ` +
    `${inv.potential.toFixed(3).padEnd(9)} | ${inv.type}`
  );
}

console.log("");
console.log("───────────────────────────────────────────────────────────────");
console.log("                    THE INVERSION INSIGHT");
console.log("───────────────────────────────────────────────────────────────");
console.log("");
console.log("  INVERSION occurs when:");
console.log("    • Solar angle is LOW (α < 0.3) - weak vertical heating");
console.log("    • Catalyst is HIGH (dθ/dt > 0.6) - strong tilt rate");
console.log("");
console.log("  Result:");
console.log("    • Energy cannot discharge VERTICALLY (no convection)");
console.log("    • Discharges HORIZONTALLY instead (surface kinetic)");
console.log("    • Creates BOMB CYCLONES - rapid surface pressure drops");
console.log("");
console.log("  Peak Windows:");
console.log("    • October-November (falling toward winter, catalyst still high)");
console.log("    • February-March (rising from winter, catalyst climbing)");
console.log("");
console.log("  This explains why major nor'easters and bomb cyclones occur");
console.log("  in late fall and late winter, NOT during deep winter.");
console.log("");

// Specific bomb cyclone test
console.log("═══════════════════════════════════════════════════════════════");
console.log("           BOMB CYCLONE CASE STUDY: NOVEMBER 15, NORTHEAST");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

const bombCase = engine.getFullForecast('northeast', 319);

console.log("  Date: November 15");
console.log("  Region: Northeast (42°N)");
console.log("");
console.log("  Factors:");
console.log(`    E-Fuel:     ${bombCase.factors.fuel.toFixed(3)}`);
console.log(`    Gradient:   ${bombCase.factors.gradient.toFixed(3)}`);
console.log(`    Catalyst:   ${bombCase.factors.catalyst.toFixed(3)}`);
console.log(`    Solar α:    ${bombCase.factors.solarAngle.toFixed(3)}`);
console.log("");
console.log("  Inversion Analysis:");
console.log(`    Mode:       ${bombCase.inversion.mode}`);
console.log(`    Type:       ${bombCase.inversion.type}`);
console.log(`    Severity:   ${bombCase.inversion.severity || 'N/A'}`);
console.log(`    Potential:  ${bombCase.inversion.potential.toFixed(3)}`);
console.log(`    Behavior:   ${bombCase.inversion.behavior}`);
console.log(`    Mechanism:  ${bombCase.inversion.mechanism}`);
console.log("");
console.log("  vs. Convective Analysis:");
console.log(`    Type:       ${bombCase.convective.prediction.type}`);
console.log(`    Danger:     ${bombCase.convective.danger.toFixed(4)}`);
console.log("");
console.log(`  ► DOMINANT MODE: ${bombCase.dominantMode}`);
console.log(`  ► PRIMARY THREAT: ${bombCase.primaryThreat}`);
console.log("");

// The matrix
console.log("═══════════════════════════════════════════════════════════════");
console.log("              THE COMPLETE METABOLIC STATE MATRIX");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");
console.log("                     │ HIGH Catalyst (>0.6)  │ LOW Catalyst (<0.3)");
console.log("  ───────────────────┼───────────────────────┼─────────────────────");
console.log("  HIGH Solar (>0.5)  │ CONVECTIVE            │ SUPPRESSED");
console.log("                     │ Tornadoes, Supercells │ Pop-up Storms");
console.log("  ───────────────────┼───────────────────────┼─────────────────────");
console.log("  LOW Solar (<0.3)   │ INVERSION             │ DORMANT");
console.log("                     │ Bomb Cyclones         │ Stable/Quiet");
console.log("");
console.log("  The INVERSION quadrant is the key insight:");
console.log("  - Conventional models focus on the CONVECTIVE quadrant");
console.log("  - DSO reveals the INVERSION quadrant drives winter storms");
console.log("");

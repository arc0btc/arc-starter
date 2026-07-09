import { cvToJSON, hexToCV } from "@stacks/transactions";
const hex = "0x0a0516a11be198a7bc4ca2d45e0895ba7d0909bc1067f6";
const cv = hexToCV(hex);
console.log(JSON.stringify(cvToJSON(cv), null, 2));

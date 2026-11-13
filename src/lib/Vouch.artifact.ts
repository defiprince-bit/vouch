export default {
  contractName: 'Vouch',
  constructorInputs: [
    { name: 'stakerPk', type: 'pubkey' },
    { name: 'verifierPk', type: 'pubkey' },
    { name: 'beneficiaryLock', type: 'bytes' },
    { name: 'deadline', type: 'int' },
    { name: 'pledgeId', type: 'bytes16' },
    { name: 'maxFee', type: 'int' },
  ],
  abi: [
    {
      name: 'keep',
      inputs: [
        { name: 'stakerSig', type: 'sig' },
        { name: 'verifierSig', type: 'sig' },
      ],
    },
    {
      name: 'breakByStaker',
      inputs: [
        { name: 'stakerSig', type: 'sig' },
      ],
    },
    {
      name: 'breakByVerifier',
      inputs: [
        { name: 'verifierSig', type: 'sig' },
      ],
    },
    { name: 'forfeit', inputs: [] },
  ],
  bytecode: 'OP_6 OP_PICK OP_0 OP_NUMEQUAL OP_IF OP_7 OP_ROLL OP_OVER OP_CHECKSIGVERIFY OP_7 OP_ROLL OP_ROT OP_CHECKSIGVERIFY OP_INPUTINDEX OP_DUP OP_OUTPUTBYTECODE 76a914 OP_3 OP_ROLL OP_HASH160 OP_CAT 88ac OP_CAT OP_EQUALVERIFY OP_DUP OP_OUTPUTVALUE OP_SWAP OP_UTXOVALUE OP_5 OP_ROLL OP_SUB OP_GREATERTHANOREQUAL OP_VERIFY OP_2DROP OP_2DROP OP_1 OP_ELSE OP_6 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_7 OP_ROLL OP_SWAP OP_CHECKSIGVERIFY OP_INPUTINDEX OP_DUP OP_OUTPUTBYTECODE OP_3 OP_ROLL OP_EQUALVERIFY OP_DUP OP_OUTPUTVALUE OP_SWAP OP_UTXOVALUE OP_5 OP_ROLL OP_SUB OP_GREATERTHANOREQUAL OP_VERIFY OP_2DROP OP_2DROP OP_1 OP_ELSE OP_6 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_7 OP_ROLL OP_ROT OP_CHECKSIGVERIFY OP_INPUTINDEX OP_DUP OP_OUTPUTBYTECODE OP_3 OP_ROLL OP_EQUALVERIFY OP_DUP OP_OUTPUTVALUE OP_SWAP OP_UTXOVALUE OP_5 OP_ROLL OP_SUB OP_GREATERTHANOREQUAL OP_VERIFY OP_2DROP OP_2DROP OP_1 OP_ELSE OP_6 OP_ROLL OP_3 OP_NUMEQUALVERIFY OP_3 OP_ROLL OP_CHECKLOCKTIMEVERIFY OP_DROP OP_INPUTINDEX OP_DUP OP_OUTPUTBYTECODE OP_4 OP_ROLL OP_EQUALVERIFY OP_DUP OP_OUTPUTVALUE OP_SWAP OP_UTXOVALUE OP_5 OP_ROLL OP_SUB OP_GREATERTHANOREQUAL OP_VERIFY OP_ROT OP_SIZE OP_NIP OP_16 OP_NUMEQUAL OP_NIP OP_NIP OP_ENDIF OP_ENDIF OP_ENDIF',
  source: 'pragma cashscript ^0.14.0;\n\n// Vouch pledge covenant (trust model: ../trust-model.md).\n//\n// One pledge = one contract address (pledgeId makes every address unique).\n//\n//   keep            staker sig + verifier sig  -> stake returns to the staker\'s P2PKH\n//   breakByStaker   staker sig (admits it)     -> stake goes to the beneficiary\n//   breakByVerifier verifier sig               -> stake goes to the beneficiary\n//   forfeit         no signature, after deadline -> stake goes to the beneficiary\n//\n// Every path:\n//   * pins its payout to tx.outputs[this.activeInputIndex], so two pledges can\'t be\n//     bundled into one transaction and pay out only once;\n//   * requires payout value >= input value - maxFee, so nobody (in particular a\n//     signature-less forfeit broadcaster) can burn the stake into miner fees.\n//\n// Verifier authorisation uses checkSig (a transaction signature), not checkDataSig:\n// WizardConnect only exposes transaction signing. A tx signature with the default\n// SIGHASH_ALL | SIGHASH_UTXOS commits to the exact outpoint being spent, so a verifier\n// signature for one pledge can never be replayed against another pledge.\ncontract Vouch(\n    pubkey stakerPk,\n    pubkey verifierPk,\n    bytes beneficiaryLock,\n    int deadline, // nLocktime: block height if < 500000000, else MTP unix seconds\n    bytes16 pledgeId,\n    int maxFee\n) {\n    function keep(sig stakerSig, sig verifierSig) {\n        require(checkSig(stakerSig, stakerPk));\n        require(checkSig(verifierSig, verifierPk));\n        int i = this.activeInputIndex;\n        require(tx.outputs[i].lockingBytecode == new LockingBytecodeP2PKH(hash160(stakerPk)));\n        require(tx.outputs[i].value >= tx.inputs[i].value - maxFee);\n    }\n\n    function breakByStaker(sig stakerSig) {\n        require(checkSig(stakerSig, stakerPk));\n        int i = this.activeInputIndex;\n        require(tx.outputs[i].lockingBytecode == beneficiaryLock);\n        require(tx.outputs[i].value >= tx.inputs[i].value - maxFee);\n    }\n\n    function breakByVerifier(sig verifierSig) {\n        require(checkSig(verifierSig, verifierPk));\n        int i = this.activeInputIndex;\n        require(tx.outputs[i].lockingBytecode == beneficiaryLock);\n        require(tx.outputs[i].value >= tx.inputs[i].value - maxFee);\n    }\n\n    function forfeit() {\n        require(tx.time >= deadline);\n        int i = this.activeInputIndex;\n        require(tx.outputs[i].lockingBytecode == beneficiaryLock);\n        require(tx.outputs[i].value >= tx.inputs[i].value - maxFee);\n        // pledgeId only needs to be part of the address; touch it so it\'s not an unused param.\n        require(pledgeId.length == 16);\n    }\n}\n',
  fingerprint: '860f52e6086cb281720f164ea990ec89012a6aaeb65d4a3edee4414970759403',
  debug: {
    bytecode: '5679009c63577a78ad577a7badc076cd0376a914537aa97e0288ac7e8876cc7cc6557a94a2696d6d51675679519c63577a7cadc076cd537a8876cc7cc6557a94a2696d6d51675679529c63577a7badc076cd537a8876cc7cc6557a94a2696d6d5167567a539d537ab175c076cd547a8876cc7cc6557a94a2697b8277609c7777686868',
    sourceMap: '30:4:36:5;;;;;31:25:31:34;;:36::44;:8::47:1;32:25:32:36:0;;:38::48;:8::51:1;33:16:33:37:0;34:27:34:28;:16::45:1;:49::92:0;:82::90;;:74::91:1;:49::92;;;:8::94;35:27:35:28:0;:16::35:1;:49::50:0;:39::57:1;:60::66:0;;:39:::1;:16;:8::68;30:50:36:5;;;:4;38::43::0;;;;;39:25:39:34;;:36::44;:8::47:1;40:16:40:37:0;41:27:41:28;:16::45:1;:49::64:0;;:8::66:1;42:27:42:28:0;:16::35:1;:49::50:0;:39::57:1;:60::66:0;;:39:::1;:16;:8::68;38:42:43:5;;;:4;45::50::0;;;;;46:25:46:36;;:38::48;:8::51:1;47:16:47:37:0;48:27:48:28;:16::45:1;:49::64:0;;:8::66:1;49:27:49:28:0;:16::35:1;:49::50:0;:39::57:1;:60::66:0;;:39:::1;:16;:8::68;45:46:50:5;;;:4;52::59::0;;;;53:27:53:35;;:8::37:1;;54:16:54::0;55:27:55:28;:16::45:1;:49::64:0;;:8::66:1;56:27:56:28:0;:16::35:1;:49::50:0;:39::57:1;:60::66:0;;:39:::1;:16;:8::68;58:16:58:24:0;:::31:1;;:35::37:0;:8::39:1;52:23:59:5;;22:0:60:1;;',
    logs: [],
    requires: [
      { ip: 14, line: 31 },
      { ip: 18, line: 32 },
      { ip: 29, line: 34 },
      { ip: 38, line: 35 },
      { ip: 51, line: 39 },
      { ip: 57, line: 41 },
      { ip: 66, line: 42 },
      { ip: 79, line: 46 },
      { ip: 85, line: 48 },
      { ip: 94, line: 49 },
      { ip: 105, line: 53 },
      { ip: 112, line: 55 },
      { ip: 121, line: 56 },
      { ip: 127, line: 58 },
    ],
    sourceTags: '121:122:sc',
  },
  compiler: {
    name: 'cashc',
    version: '0.14.0',
    options: {
      enforceFunctionParameterTypes: true,
      enforceLocktimeGuard: true,
    },
  },
  updatedAt: '2026-11-13T17:21:19.138Z',
} as const;

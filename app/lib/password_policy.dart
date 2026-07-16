/// Password rules, mirroring the backend's lib/password.ts.
///
/// Kept in step deliberately: if the meter here promised something the API then
/// rejected, the member would be told their password is "strong" and then have
/// signup fail with no explanation. The server is still the real gate — this
/// exists so the feedback is immediate and honest.
library;

const int kPasswordMin = 10;

/// Passwords common enough that any other rule is beside the point.
const _common = <String>{
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'qwerty',
  'qwerty123', 'qwertyuiop', 'letmein', 'welcome', 'welcome1', 'iloveyou',
  'admin', 'admin123', 'football', 'monkey', 'dragon', 'sunshine', 'princess',
  'abc123', '123456', '1234567', '12345678', '123456789', '1234567890',
  '111111', '000000', 'motoriq', 'motoriq1', 'motoriq123', 'liverpool',
  'arsenal', 'chelsea', 'charlie', 'trustno1', 'superman', 'batman',
};

/// Only substitutions that can't be a genuine digit — leaves 1/3/7 alone so
/// "p@ssw0rd123" folds to "password123" rather than "passwordi2e".
String _deLeetSafe(String s) => s
    .toLowerCase()
    .replaceAll('@', 'a')
    .replaceAll('4', 'a')
    .replaceAll(r'$', 's')
    .replaceAll('5', 's')
    .replaceAll('0', 'o')
    .replaceAll('+', 't');

/// For words spelled entirely in leet ("l3tm31n").
String _deLeetAggressive(String s) => _deLeetSafe(s)
    .replaceAll('3', 'e')
    .replaceAll(RegExp(r'[1!|]'), 'i')
    .replaceAll('7', 't');

bool _isCommon(String pw) {
  final lower = pw.toLowerCase();
  final alnum = lower.replaceAll(RegExp(r'[^a-z0-9]'), '');
  final variants = <String>{};

  // Fold both with punctuation intact ("p@ssw0rd") and with it stripped
  // ("l3tm31n!!!"), because each case only folds correctly one way round.
  for (final core in [
    lower,
    alnum,
    alnum.replaceAll(RegExp(r'\d+$'), ''),
    alnum.replaceAll(RegExp(r'^\d+'), ''),
  ]) {
    for (final folded in [core, _deLeetSafe(core), _deLeetAggressive(core)]) {
      variants.add(folded);
      variants.add(folded.replaceAll(RegExp(r'[^a-z0-9]'), ''));
      variants.add(folded.replaceAll(RegExp(r'[^a-z]'), ''));
      variants.add(
          folded.replaceAll(RegExp(r'[^a-z0-9]'), '').replaceAll(RegExp(r'\d+$'), ''));
    }
  }
  return variants.any((v) => v.length >= 4 && _common.contains(v));
}

/// A run of 4+ repeated or sequential characters ("aaaa", "1234", "dcba").
bool _hasWeakRun(String pw) {
  final s = pw.toLowerCase();
  var repeat = 1, asc = 1, desc = 1;
  for (var i = 1; i < s.length; i++) {
    final prev = s.codeUnitAt(i - 1);
    final cur = s.codeUnitAt(i);
    repeat = cur == prev ? repeat + 1 : 1;
    asc = cur == prev + 1 ? asc + 1 : 1;
    desc = cur == prev - 1 ? desc + 1 : 1;
    if (repeat >= 4 || asc >= 4 || desc >= 4) return true;
  }
  return false;
}

int _classCount(String pw) => [
      RegExp(r'[a-z]'),
      RegExp(r'[A-Z]'),
      RegExp(r'\d'),
      RegExp(r'[^A-Za-z0-9]'),
    ].where((r) => r.hasMatch(pw)).length;

/// 0 weak · 1 fair · 2 good · 3 strong.
int passwordScore(String pw) {
  if (pw.isEmpty || _isCommon(pw) || pw.length < kPasswordMin) return 0;
  final classes = _classCount(pw);
  if (_hasWeakRun(pw)) return classes.clamp(0, 1);

  // Length outweighs class count on purpose: a long lowercase passphrase
  // genuinely beats a short "complex" password.
  var points = 0;
  if (pw.length >= 10) points++;
  if (pw.length >= 14) points++;
  if (pw.length >= 20) points++;
  if (pw.length >= 24) points++;
  if (classes >= 3) points++;
  if (classes == 4) points++;
  // Penalise real repetition, not ordinary English — "correct horse battery
  // staple" is ~0.46 unique and is a strong passphrase.
  if (pw.split('').toSet().length / pw.length < 0.35) points--;

  return (points - 1).clamp(0, 3);
}

/// The first thing wrong with this password, or null if it's acceptable.
/// [email], [firstName], [lastName] catch passwords built from their own identity.
String? passwordIssue(
  String pw, {
  String? email,
  String? firstName,
  String? lastName,
}) {
  if (pw.length < kPasswordMin) return 'Use at least $kPasswordMin characters';
  if (pw.length > 200) return 'Keep it under 200 characters';

  if (pw.length < 16 && _classCount(pw) < 3) {
    return 'Mix upper and lower case, numbers or symbols — or use a longer passphrase';
  }
  if (_isCommon(pw)) return 'This password is too common — pick something else';
  if (_hasWeakRun(pw)) return 'Avoid runs like "1234" or "aaaa"';

  final flat = _deLeetAggressive(pw);
  final parts = <String?>[email?.split('@').first, firstName, lastName]
      .whereType<String>()
      .where((p) => p.length >= 3)
      .map(_deLeetAggressive);
  if (parts.any(flat.contains)) {
    return "Don't use your name or email address in your password";
  }
  return null;
}

const passwordScoreLabels = ['Weak', 'Fair', 'Good', 'Strong'];

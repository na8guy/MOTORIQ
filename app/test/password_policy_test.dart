import 'package:flutter_test/flutter_test.dart';
import 'package:saveondrive_app/password_policy.dart';

/// These cases mirror the backend's password test exactly. If the two ever
/// disagree, the meter would call a password strong and the API would reject
/// it — so this is the contract between them.
void main() {
  const email = 'wood.tyna@gmail.com';
  const first = 'Tyna';
  const last = 'Wood';

  String? issue(String pw) =>
      passwordIssue(pw, email: email, firstName: first, lastName: last);

  group('rejects weak passwords', () {
    for (final pw in [
      'Passw0rd!!', 'P@ssw0rd123', 'password123', 'l3tm31n!!!', 'L3tM3In123',
      'saveondrive123', 'SaveOnDrive1!!', 'Qw3rty123!', 'qwerty123456', 'aaaaaaaaaaaa',
      'abcd1234efgh', 'Tyna2020!!x', 'wood.tyna99!X', 'Welcome1!!',
      'Iloveyou99!', r'$unshine123', '123Password', 'Dr@gon1234', 'F00tball11',
      'short1!',
    ]) {
      test(pw, () => expect(issue(pw), isNotNull, reason: '$pw must be rejected'));
    }
  });

  group('accepts strong passwords', () {
    for (final pw in [
      'correct horse battery staple',
      'Tr0ub4dor&3xkcd',
      'SaveOnDrive_Fuel_92!',
      'Rainy-Kettle-88',
      'jubilant tractor mango 7',
      'Vg7#qLpZ2m',
      'Brimful-Otter-2026',
    ]) {
      test(pw, () => expect(issue(pw), isNull, reason: '$pw must be accepted'));
    }
  });

  group('scoring matches the backend', () {
    test('common passwords score 0', () => expect(passwordScore('Passw0rd!!'), 0));
    test('repetition is penalised', () => expect(passwordScore('aaaaaaaaaaab'), 1));
    test('short mixed is good', () => expect(passwordScore('Vg7#qLpZ2m'), 2));
    test('long passphrase is strong', () => expect(passwordScore('correct horse battery staple'), 3));
    test('long mixed is strong', () => expect(passwordScore('Brimful-Otter-2026'), 3));
    test('empty scores 0', () => expect(passwordScore(''), 0));
  });
}

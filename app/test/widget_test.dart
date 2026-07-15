// Basic smoke test for the MOTORIQ app.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:motoriq_app/services/api_client.dart';
import 'package:motoriq_app/main.dart';

void main() {
  testWidgets('App boots to a MaterialApp', (WidgetTester tester) async {
    await tester.pumpWidget(MotoriqApp(api: ApiClient()));
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}

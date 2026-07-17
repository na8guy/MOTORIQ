import 'package:flutter/material.dart';
import '../theme.dart';

/// Animated MOTORIQ splash, shown while the app restores the session
/// (AuthState.bootstrap). The background matches the native LaunchScreen's
/// navy so the hand-off from the iOS launch image is seamless — no flash.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  late final AnimationController _intro;
  late final AnimationController _pulse;

  late final Animation<double> _badgeScale;
  late final Animation<double> _badgeFade;
  late final Animation<double> _wordFade;
  late final Animation<Offset> _wordSlide;
  late final Animation<double> _taglineFade;
  late final Animation<double> _barGrow;

  @override
  void initState() {
    super.initState();

    _intro = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..forward();

    // Keeps breathing while we wait on the network (Render can cold-start).
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat(reverse: true);

    Animation<double> curve(double begin, double end, Curve c) => CurvedAnimation(
          parent: _intro,
          curve: Interval(begin, end, curve: c),
        );

    _badgeFade = curve(0.00, 0.45, Curves.easeOut);
    _badgeScale = Tween(begin: 0.62, end: 1.0).animate(curve(0.00, 0.60, Curves.easeOutBack));
    _wordFade = curve(0.30, 0.70, Curves.easeOut);
    _wordSlide = Tween(begin: const Offset(0, 0.45), end: Offset.zero)
        .animate(curve(0.30, 0.75, Curves.easeOutCubic));
    _taglineFade = curve(0.55, 0.90, Curves.easeOut);
    _barGrow = curve(0.60, 1.00, Curves.easeOutCubic);
  }

  @override
  void dispose() {
    _intro.dispose();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kBrandDark,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF12345E), kBrandDark],
          ),
        ),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Badge + wordmark (mirrors the login screen logo).
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  FadeTransition(
                    opacity: _badgeFade,
                    child: ScaleTransition(
                      scale: _badgeScale,
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: context.mq.accent,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: context.mq.accent.withValues(alpha: 0.45),
                              blurRadius: 28,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: const Icon(Icons.directions_car_filled,
                            color: Colors.white, size: 34),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  FadeTransition(
                    opacity: _wordFade,
                    child: SlideTransition(
                      position: _wordSlide,
                      child: const Text(
                        'MOTORIQ',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 34,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.5,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              FadeTransition(
                opacity: _taglineFade,
                child: const Text(
                  'The Smart Membership for Cheaper Driving',
                  style: TextStyle(color: Colors.white70, fontSize: 13),
                ),
              ),
              const SizedBox(height: 34),
              // Green accent bar: grows in, then breathes while loading.
              AnimatedBuilder(
                animation: Listenable.merge([_intro, _pulse]),
                builder: (context, _) {
                  final settled = _intro.isCompleted;
                  return Opacity(
                    opacity: settled ? 0.45 + (_pulse.value * 0.55) : 1.0,
                    child: Container(
                      width: 120 * _barGrow.value,
                      height: 5,
                      decoration: BoxDecoration(
                        color: context.mq.money,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

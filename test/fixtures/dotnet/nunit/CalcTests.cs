namespace Calc.Tests;

public class CalcTests
{
    [Test]
    public void Adds() => Assert.That(2 + 2, Is.EqualTo(4));

    [Test]
    public void Subtracts() => Assert.That(3 - 1, Is.EqualTo(1));

    [Test, Ignore("not ready")]
    public void Divides() => Assert.That(4 / 2, Is.EqualTo(2));

    [TestCase(2, 4)]
    [TestCase(3, 7)]
    public void Doubles(int input, int expected) => Assert.That(input * 2, Is.EqualTo(expected));
}

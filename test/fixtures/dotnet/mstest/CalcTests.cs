namespace Calc.Tests;

[TestClass]
public sealed class CalcTests
{
    [TestMethod]
    public void Adds() => Assert.AreEqual(4, 2 + 2);

    [TestMethod]
    public void Subtracts() => Assert.AreEqual(1, 3 - 1);

    [TestMethod, Ignore("not ready")]
    public void Divides() => Assert.AreEqual(2, 4 / 2);

    [TestMethod]
    [DataRow(2, 4)]
    [DataRow(3, 7)]
    public void Doubles(int input, int expected) => Assert.AreEqual(expected, input * 2);
}

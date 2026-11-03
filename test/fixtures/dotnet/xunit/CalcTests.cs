namespace Calc.Tests;

public class CalcTests
{
    [Fact]
    public void Adds() => Assert.Equal(4, 2 + 2);

    [Fact]
    public void Subtracts() => Assert.Equal(1, 3 - 1);

    [Fact(Skip = "not ready")]
    public void Divides() => Assert.Equal(2, 4 / 2);

    [Theory]
    [InlineData(2, 4)]
    [InlineData(3, 7)]
    public void Doubles(int input, int expected) => Assert.Equal(expected, input * 2);
}

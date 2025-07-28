import { add, multiply, calculate, Calculator } from './math.js';

const result1 = add(2, 3);
const result2 = multiply(4, 5);
const result3 = calculate(6, 7);

const calc = new Calculator();
const result4 = calc.add(8, 9);
const result5 = calc.multiply(10, 11);
const result6 = calc.calculate(12, 13);

function processNumbers(nums: number[]): number {
  return nums.reduce((acc, num, idx) => {
    if (idx % 2 === 0) {
      return add(acc, num);
    } else {
      return multiply(acc, num);
    }
  }, 0);
}

console.log(result1, result2, result3, result4, result5, result6);
console.log(processNumbers([1, 2, 3, 4, 5]));
import { ASTv2, generateSyntaxError, SourceSlice, SourceSpan } from '@glimmer/syntax';
import { expect } from '@glimmer/util';

import { Err, Ok, Result } from '../../../shared/result';
import * as mir from '../../2-encoding/mir';
import { NormalizationState } from '../context';
import { VISIT_EXPRS } from '../visitors/expressions';
import { keywords } from './impl';
import { assertValidCurryUsage } from './utils/curry';
import { assertValidHasBlockUsage } from './utils/has-block';
import { assertValidIfUnlessInlineUsage } from './utils/if-unless';

export const APPEND_KEYWORDS = keywords('Append')
  .kw('yield', {
    assert(
      node: ASTv2.AppendContent
    ): Result<{
      target: SourceSlice;
      positional: ASTv2.PositionalArguments;
    }> {
      let { args } = node;

      if (args.named.isEmpty()) {
        return Ok({
          target: SourceSpan.synthetic('default').toSlice(),
          positional: args.positional,
        });
      } else {
        let target = args.named.get('to');

        if (args.named.size > 1 || target === null) {
          return Err(
            generateSyntaxError(`yield only takes a single named argument: 'to'`, args.named.loc)
          );
        }

        if (ASTv2.isLiteral(target, 'string')) {
          return Ok({ target: target.toSlice(), positional: args.positional });
        } else {
          return Err(
            generateSyntaxError(`you can only yield to a literal string value`, target.loc)
          );
        }
      }
    },

    translate(
      { node, state }: { node: ASTv2.AppendContent; state: NormalizationState },
      {
        target,
        positional,
      }: {
        target: SourceSlice;
        positional: ASTv2.PositionalArguments;
      }
    ): Result<mir.Statement> {
      return VISIT_EXPRS.Positional(positional, state).mapOk(
        (positional) =>
          new mir.Yield({
            loc: node.loc,
            target,
            to: state.scope.allocateBlock(target.chars),
            positional,
          })
      );
    },
  })
  .kw('partial', {
    assert(
      node: ASTv2.AppendContent,
      state: NormalizationState
    ): Result<ASTv2.ExpressionNode | undefined> {
      if (state.isStrict) {
        return Err(
          generateSyntaxError('{{partial}} is not allowed in strict mode templates', node.loc)
        );
      }

      let {
        args: { positional, named },
      } = node;
      let { trusting } = node;

      if (positional.isEmpty()) {
        return Err(
          generateSyntaxError(
            `Partial found with no arguments. You must specify a template name`,
            node.loc
          )
        );
      } else if (positional.size !== 1) {
        return Err(
          generateSyntaxError(
            `Partial found with ${positional.exprs.length} arguments. You must specify a template name`,
            node.loc
          )
        );
      }

      if (named.isEmpty()) {
        if (trusting) {
          return Err(
            generateSyntaxError(
              `{{{partial ...}}} is not supported, please use {{partial ...}} instead`,
              node.loc
            )
          );
        }

        return Ok(expect(positional.nth(0), `already confirmed that positional has a 0th entry`));
      } else {
        return Err(generateSyntaxError(`Partial does not take any named argument`, node.loc));
      }
    },

    translate(
      { node, state }: { node: ASTv2.AppendContent; state: NormalizationState },
      expr: ASTv2.ExpressionNode | undefined
    ): Result<mir.Statement> {
      state.scope.setHasEval();

      let visited =
        expr === undefined
          ? Ok(
              new ASTv2.LiteralExpression({
                loc: SourceSpan.synthetic('undefined'),
                value: undefined,
              })
            )
          : VISIT_EXPRS.visit(expr, state);

      return visited.mapOk(
        (target) => new mir.Partial({ loc: node.loc, scope: state.scope, target })
      );
    },
  })
  .kw('debugger', {
    assert(node: ASTv2.AppendContent): Result<void> {
      let { args } = node;
      let { positional } = args;

      if (args.isEmpty()) {
        return Ok(undefined);
      } else {
        if (positional.isEmpty()) {
          return Err(generateSyntaxError(`debugger does not take any named arguments`, node.loc));
        } else {
          return Err(
            generateSyntaxError(`debugger does not take any positional arguments`, node.loc)
          );
        }
      }
    },

    translate({
      node,
      state: { scope },
    }: {
      node: ASTv2.AppendContent;
      state: NormalizationState;
    }): Result<mir.Statement> {
      scope.setHasEval();
      return Ok(new mir.Debugger({ loc: node.loc, scope }));
    },
  })
  .kw('has-block', {
    assert(node: ASTv2.AppendContent): Result<SourceSlice> {
      return assertValidHasBlockUsage('has-block', node);
    },
    translate(
      { node, state: { scope } }: { node: ASTv2.AppendContent; state: NormalizationState },
      target: SourceSlice
    ): Result<mir.AppendTextNode> {
      let text = new mir.HasBlock({
        loc: node.loc,
        target,
        symbol: scope.allocateBlock(target.chars),
      });
      return Ok(new mir.AppendTextNode({ loc: node.loc, text }));
    },
  })
  .kw('has-block-params', {
    assert(node: ASTv2.AppendContent): Result<SourceSlice> {
      return assertValidHasBlockUsage('has-block-params', node);
    },
    translate(
      { node, state: { scope } }: { node: ASTv2.AppendContent; state: NormalizationState },
      target: SourceSlice
    ): Result<mir.AppendTextNode> {
      let text = new mir.HasBlockParams({
        loc: node.loc,
        target,
        symbol: scope.allocateBlock(target.chars),
      });
      return Ok(new mir.AppendTextNode({ loc: node.loc, text }));
    },
  })
  .kw('if', {
    assert: assertValidIfUnlessInlineUsage('{{if}}', false),

    translate(
      { node, state }: { node: ASTv2.AppendContent; state: NormalizationState },
      {
        condition,
        truthy,
        falsy,
      }: {
        condition: ASTv2.ExpressionNode;
        truthy: ASTv2.ExpressionNode;
        falsy: ASTv2.ExpressionNode | null;
      }
    ): Result<mir.AppendTextNode> {
      let conditionResult = VISIT_EXPRS.visit(condition, state);
      let truthyResult = VISIT_EXPRS.visit(truthy, state);
      let falsyResult = falsy ? VISIT_EXPRS.visit(falsy, state) : Ok(null);

      return Result.all(conditionResult, truthyResult, falsyResult).mapOk(
        ([condition, truthy, falsy]) => {
          let text = new mir.IfInline({
            loc: node.loc,
            condition,
            truthy,
            falsy,
          });

          return new mir.AppendTextNode({ loc: node.loc, text });
        }
      );
    },
  })
  .kw('unless', {
    assert: assertValidIfUnlessInlineUsage('{{unless}}', true),

    translate(
      { node, state }: { node: ASTv2.AppendContent; state: NormalizationState },
      {
        condition,
        truthy,
        falsy,
      }: {
        condition: ASTv2.ExpressionNode;
        truthy: ASTv2.ExpressionNode;
        falsy: ASTv2.ExpressionNode | null;
      }
    ): Result<mir.AppendTextNode> {
      let conditionResult = VISIT_EXPRS.visit(condition, state);
      let truthyResult = VISIT_EXPRS.visit(truthy, state);
      let falsyResult = falsy ? VISIT_EXPRS.visit(falsy, state) : Ok(null);

      return Result.all(conditionResult, truthyResult, falsyResult).mapOk(
        ([condition, truthy, falsy]) => {
          let text = new mir.IfInline({
            loc: node.loc,
            condition: new mir.Not({ value: condition, loc: node.loc }),
            truthy,
            falsy,
          });

          return new mir.AppendTextNode({ loc: node.loc, text });
        }
      );
    },
  })
  .kw('component', {
    assert: assertValidCurryUsage('{{component}}', 'component', true),

    translate(
      { node, state }: { node: ASTv2.AppendContent; state: NormalizationState },
      { definition, args }: { definition: ASTv2.ExpressionNode; args: ASTv2.Args }
    ): Result<mir.InvokeComponent> {
      let definitionResult = VISIT_EXPRS.visit(definition, state);
      let argsResult = VISIT_EXPRS.Args(args, state);

      return Result.all(definitionResult, argsResult).mapOk(
        ([definition, args]) =>
          new mir.InvokeComponent({
            loc: node.loc,
            definition,
            args,
            blocks: null,
          })
      );
    },
  })
  .kw('helper', {
    assert: assertValidCurryUsage('{{helper}}', 'helper', false),

    translate(
      { node, state }: { node: ASTv2.AppendContent; state: NormalizationState },
      { definition, args }: { definition: ASTv2.ExpressionNode; args: ASTv2.Args }
    ): Result<mir.AppendTextNode> {
      let definitionResult = VISIT_EXPRS.visit(definition, state);
      let argsResult = VISIT_EXPRS.Args(args, state);

      return Result.all(definitionResult, argsResult).mapOk(([definition, args]) => {
        let text = new mir.CallExpression({ callee: definition, args, loc: node.loc });

        return new mir.AppendTextNode({
          loc: node.loc,
          text,
        });
      });
    },
  });

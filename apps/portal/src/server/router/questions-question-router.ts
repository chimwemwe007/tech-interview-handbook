import { z } from 'zod';
import { QuestionsQuestionType, Vote } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { createProtectedRouter } from './context';

import type { Question } from '~/types/questions';

export const questionsQuestionRouter = createProtectedRouter()
  .query('getQuestionsByFilter', {
    input: z.object({
      companies: z.string().array(),
      endDate: z.date(),
      locations: z.string().array(),
      questionTypes: z.nativeEnum(QuestionsQuestionType).array(),
      roles: z.string().array(),
      startDate: z.date().optional(),
    }),
    async resolve({ ctx, input }) {
      const questionsData = await ctx.prisma.questionsQuestion.findMany({
        include: {
          _count: {
            select: {
              answers: true,
              comments: true,
            },
          },
          encounters: {
            select: {
              company: true,
              location: true,
              role: true,
              seenAt: true,
            },
          },
          user: {
            select: {
              name: true,
            },
          },
          votes: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        where: {
          ...(input.questionTypes.length > 0
            ? {
                questionType: {
                  in: input.questionTypes,
                },
              }
            : {}),
        },
      });
      return questionsData
        .filter((data) => {
          for (let i = 0; i < data.encounters.length; i++) {
            const encounter = data.encounters[i];
            const matchCompany =
              input.companies.length === 0 ||
              input.companies.includes(encounter.company);
            const matchLocation =
              input.locations.length === 0 ||
              input.locations.includes(encounter.location);
            const matchRole =
              input.roles.length === 0 || input.roles.includes(encounter.role);
            const matchDate =
              (!input.startDate || encounter.seenAt >= input.startDate) &&
              encounter.seenAt <= input.endDate;
            if (matchCompany && matchLocation && matchRole && matchDate) {
              return true;
            }
          }
          return false;
        })
        .map((data) => {
          const votes: number = data.votes.reduce(
            (previousValue: number, currentValue) => {
              let result: number = previousValue;

              switch (currentValue.vote) {
                case Vote.UPVOTE:
                  result += 1;
                  break;
                case Vote.DOWNVOTE:
                  result -= 1;
                  break;
              }
              return result;
            },
            0,
          );

          const question: Question = {
            company: data.encounters[0].company,
            content: data.content,
            id: data.id,
            location: data.encounters[0].location ?? 'Unknown location',
            numAnswers: data._count.answers,
            numComments: data._count.comments,
            numVotes: votes,
            role: data.encounters[0].role ?? 'Unknown role',
            seenAt: data.encounters[0].seenAt,
            type: data.questionType,
            updatedAt: data.updatedAt,
            user: data.user?.name ?? '',
          };
          return question;
        });
    },
  })
  .query('getQuestionById', {
    input: z.object({
      id: z.string(),
    }),
    async resolve({ ctx, input }) {
      const questionData = await ctx.prisma.questionsQuestion.findUnique({
        include: {
          _count: {
            select: {
              answers: true,
              comments: true,
            },
          },
          encounters: {
            select: {
              company: true,
              location: true,
              role: true,
              seenAt: true,
            },
          },
          user: {
            select: {
              name: true,
            },
          },
          votes: true,
        },
        where: {
          id: input.id,
        },
      });
      if (!questionData) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Question not found',
        });
      }
      const votes: number = questionData.votes.reduce(
        (previousValue: number, currentValue) => {
          let result: number = previousValue;

          switch (currentValue.vote) {
            case Vote.UPVOTE:
              result += 1;
              break;
            case Vote.DOWNVOTE:
              result -= 1;
              break;
          }
          return result;
        },
        0,
      );

      const question: Question = {
        company: questionData.encounters[0].company,
        content: questionData.content,
        id: questionData.id,
        location: questionData.encounters[0].location ?? 'Unknown location',
        numAnswers: questionData._count.answers,
        numComments: questionData._count.comments,
        numVotes: votes,
        role: questionData.encounters[0].role ?? 'Unknown role',
        seenAt: questionData.encounters[0].seenAt,
        type: questionData.questionType,
        updatedAt: questionData.updatedAt,
        user: questionData.user?.name ?? '',
      };
      return question;
    },
  })
  .mutation('create', {
    input: z.object({
      company: z.string(),
      content: z.string(),
      location: z.string(),
      questionType: z.nativeEnum(QuestionsQuestionType),
      role: z.string(),
      seenAt: z.date(),
    }),
    async resolve({ ctx, input }) {
      const userId = ctx.session?.user?.id;

      const question = await ctx.prisma.questionsQuestion.create({
        data: {
          content: input.content,
          encounters: {
            create: [
              {
                company: input.company,
                location: input.location,
                role: input.role,
                seenAt: input.seenAt,
                userId,
              },
            ],
          },
          questionType: input.questionType,
          userId,
        },
      });

      // Create question encounter
      await ctx.prisma.questionsQuestionEncounter.create({
        data: {
          company: input.company,
          location: input.location,
          questionId: question.id,
          role: input.role,
          seenAt: input.seenAt,
          userId,
        },
      });

      return question;
    },
  })
  .mutation('update', {
    input: z.object({
      content: z.string().optional(),
      id: z.string(),
      questionType: z.nativeEnum(QuestionsQuestionType).optional(),
    }),
    async resolve({ ctx, input }) {
      const userId = ctx.session?.user?.id;

      const questionToUpdate = await ctx.prisma.questionsQuestion.findUnique({
        where: {
          id: input.id,
        },
      });

      if (questionToUpdate?.id !== userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User have no authorization to record.',
          // Optional: pass the original error to retain stack trace
        });
      }

      return await ctx.prisma.questionsQuestion.update({
        data: {
          ...input,
        },
        where: {
          id: input.id,
        },
      });
    },
  })
  .mutation('delete', {
    input: z.object({
      id: z.string(),
    }),
    async resolve({ ctx, input }) {
      const userId = ctx.session?.user?.id;

      const questionToDelete = await ctx.prisma.questionsQuestion.findUnique({
        where: {
          id: input.id,
        },
      });

      if (questionToDelete?.id !== userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User have no authorization to record.',
          // Optional: pass the original error to retain stack trace
        });
      }

      return await ctx.prisma.questionsQuestion.delete({
        where: {
          id: input.id,
        },
      });
    },
  })
  .query('getVote', {
    input: z.object({
      questionId: z.string(),
    }),
    async resolve({ ctx, input }) {
      const userId = ctx.session?.user?.id;
      const { questionId } = input;

      return await ctx.prisma.questionsQuestionVote.findUnique({
        where: {
          questionId_userId: { questionId, userId },
        },
      });
    },
  })
  .mutation('createVote', {
    input: z.object({
      questionId: z.string(),
      vote: z.nativeEnum(Vote),
    }),
    async resolve({ ctx, input }) {
      const userId = ctx.session?.user?.id;

      return await ctx.prisma.questionsQuestionVote.create({
        data: {
          ...input,
          userId,
        },
      });
    },
  })
  .mutation('updateVote', {
    input: z.object({
      id: z.string(),
      vote: z.nativeEnum(Vote),
    }),
    async resolve({ ctx, input }) {
      const userId = ctx.session?.user?.id;
      const { id, vote } = input;

      const voteToUpdate = await ctx.prisma.questionsQuestionVote.findUnique({
        where: {
          id: input.id,
        },
      });

      if (voteToUpdate?.userId !== userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User have no authorization to record.',
        });
      }

      return await ctx.prisma.questionsQuestionVote.update({
        data: {
          vote,
        },
        where: {
          id,
        },
      });
    },
  })
  .mutation('deleteVote', {
    input: z.object({
      id: z.string(),
    }),
    async resolve({ ctx, input }) {
      const userId = ctx.session?.user?.id;

      const voteToDelete = await ctx.prisma.questionsQuestionVote.findUnique({
        where: {
          id: input.id,
        },
      });

      if (voteToDelete?.userId !== userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'User have no authorization to record.',
        });
      }

      return await ctx.prisma.questionsQuestionVote.delete({
        where: {
          id: input.id,
        },
      });
    },
  });
